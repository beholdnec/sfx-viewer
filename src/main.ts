import { mat4 } from 'gl-matrix'

console.log('Hello, world!')

const canvas = <HTMLCanvasElement>document.getElementById('main-canvas')
const desiredWidth = canvas.width
const desiredHeight = canvas.height
canvas.setAttribute('style', `width: ${desiredWidth}px; height: ${desiredHeight}px`)
const devicePixelRatio = window.devicePixelRatio || 1
canvas.width = desiredWidth * devicePixelRatio
canvas.height = desiredHeight * devicePixelRatio

// Get GL context AFTER resizing canvas, otherwise the viewport is wrong.
const gl = <WebGL2RenderingContext>canvas.getContext('webgl2')

function clamp(a: number, lo: number, hi: number)
{
    if (a < lo)
        return lo
    else if (a > hi)
        return hi
    else
        return a
}

function mat4_mul(a: mat4, b: mat4)
{
    const result = mat4.create()
    mat4.mul(result, a, b)
    return result
}

function mat4_rotateX(rad: number)
{
    const result = mat4.create()
    mat4.rotateX(result, mat4.create(), rad)
    return result
}

function mat4_rotateY(rad: number)
{
    const result = mat4.create()
    mat4.rotateY(result, mat4.create(), rad)
    return result
}

function mat4_rotateZ(rad: number)
{
    const result = mat4.create()
    mat4.rotateZ(result, mat4.create(), rad)
    return result
}

function mat4_scale(x: number, y: number, z: number)
{
    const result = mat4.create()
    mat4.fromScaling(result, [x, y, z])
    return result
}

function compileShader(shaderType: number, source: string): WebGLShader
{
    const shader = gl.createShader(shaderType)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    {
        console.error(gl.getShaderInfoLog(shader))
        throw new Error('Failed to compile shader')
    }

    return shader
}

function compileProgram(vertexShaderSource: string, fragmentShaderSource: string): WebGLProgram
{
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource)

    const program = gl.createProgram()
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    {
        console.error(gl.getProgramInfoLog(program))
        throw new Error('Failed to compile program')
    }

    return program
}

const SFX_VERTEX_SHADER_SOURCE =
`#version 300 es
precision mediump float;

in vec3 aPosition;

uniform mat4 uModelMatrix;
uniform mat4 uViewProjMatrix;

out vec3 vWorldPosition;

void main()
{
    vWorldPosition = (uModelMatrix * vec4(aPosition, 1.)).xyz;
    gl_Position = uViewProjMatrix * vec4(vWorldPosition, 1.);
    gl_PointSize = 4.;
}
`

const SFX_FRAGMENT_SHADER_SOURCE =
`#version 300 es
precision mediump float;

in vec3 vWorldPosition;

out vec4 oColor;

void main()
{
    vec3 incident = vec3(0., 0., -1.);
    vec3 L = normalize(-incident);
    vec3 N = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    float NdotL = dot(N, L);
    oColor = vec4(vec3(NdotL), 1.);
}
`

class SFXShader
{
    aPosition: number
    uModelMatrix: WebGLUniformLocation
    uViewProjMatrix: WebGLUniformLocation

    program: WebGLProgram

    constructor()
    {
        this.program = compileProgram(SFX_VERTEX_SHADER_SOURCE, SFX_FRAGMENT_SHADER_SOURCE)

        this.aPosition = gl.getAttribLocation(this.program, 'aPosition')
        this.uModelMatrix = gl.getUniformLocation(this.program, 'uModelMatrix')
        this.uViewProjMatrix = gl.getUniformLocation(this.program, 'uViewProjMatrix')
    }
}

enum VertexCmd
{
    Plain = 0x04,
    End = 0x0C,
    AnimatedList = 0x1C,
    Jump = 0x20,
    XFlipped = 0x38,
}

enum FaceCmd
{
    FaceGroup = 0x14,
    TriangleList = 0x30,
    BSPTree = 0x3C,
}

enum NodeType
{
    Branch = 0x28,
    Null = 0x40,
    Leaf = 0x44,
}

class Face
{
    numVerts: number
    faceId: number
    color: number
    nx: number
    ny: number
    nz: number
    verts: number[]
}

class SFXObject
{
    rom: ArrayBuffer
    verticesAddress: number = 0
    facesAddress: number = 0
    curFrame: number = 0
    numFrames: number = 0
    vertices: number[] = []
    faces: Face[] = []
    shader: SFXShader

    vertexBuffer = gl.createBuffer()

    constructor(rom: ArrayBuffer, verticesAddress: number, facesAddress: number)
    {
        this.rom = rom
        this.verticesAddress = verticesAddress
        this.facesAddress = this.facesAddress

        this.shader = new SFXShader()

        const dv = new DataView(rom)

        const self = this

        // Load vertices
        this.loadFrame(0)

        const parseTriangleList = function ()
        {
            const result = []

            const num = dv.getUint8(cursor)
            cursor++
            for (let i = 0; i < num; i++)
            {
                const tri0 = dv.getUint8(cursor)
                cursor++
                const tri1 = dv.getUint8(cursor)
                cursor++
                const tri2 = dv.getUint8(cursor)
                cursor++

                result.push(tri0, tri1, tri2)
            }

            return result
        }

        const parseFaceGroup: () => Face[] = function ()
        {
            const result = []

            var groupDone = false
            while (!groupDone)
            {
                const face = new Face()

                face.numVerts = dv.getUint8(cursor)
                cursor++
                if (face.numVerts >= 0xFE)
                {
                    console.warn(`End of facegroup marker 0x${face.numVerts.toString(16)} encountered`)
                    groupDone = true
                    break
                }


                face.faceId = dv.getUint8(cursor)
                cursor++
                face.color = dv.getUint8(cursor)
                cursor++
                face.nx = dv.getUint8(cursor)
                cursor++
                face.ny = dv.getUint8(cursor)
                cursor++
                face.nz = dv.getUint8(cursor)
                cursor++

                face.verts = []
                for (let i = 0; i < face.numVerts; i++)
                {
                    face.verts.push(dv.getUint8(cursor))
                    cursor++
                }

                console.log(`Face: num verts ${face.numVerts}; face id ${face.faceId}; color ${face.color}; n ${face.nx},${face.ny},${face.nz}; verts ${face.verts}`)

                result.push(face)
            }

            return result
        }
        
        const parseBSPNode = function ()
        {
            const nodeType = dv.getUint8(cursor)
            cursor++

            switch (nodeType)
            {
            case NodeType.Branch:
            {
                const splittingTri = dv.getUint8(cursor)
                cursor++
                const facegroupOffset = dv.getUint16(cursor, true)
                cursor += 2

                const oldCursor = cursor
                cursor += facegroupOffset
                const faces = parseFaceGroup()
                self.faces = self.faces.concat(faces)
                cursor = oldCursor

                const frontBranchOffset = dv.getUint8(cursor)
                cursor++
                // The renderer would check whether the camera is in front of the splitting
                // triangle and render the back node if not. Otherwise, only the front node is
                // rendered. To avoid parsing back node data, the cursor is increased by
                // frontBranchOffset.

                console.log(`Node: split tri ${splittingTri}; facegroup 0x${facegroupOffset.toString(16)}; front offset ${frontBranchOffset}`)

                const backNode = parseBSPNode()
                if (frontBranchOffset == 0)
                    throw new Error(`Front branch offset = 0 detected; breakage imminent!`)
                const frontNode = parseBSPNode()
                break
            }
            case NodeType.Null:
                console.log(`Null node`)
                break
            case NodeType.Leaf:
            {
                const facegroupOffset = dv.getUint16(cursor, true)
                cursor += 2
                console.log(`Leaf: facegroup 0x${facegroupOffset.toString(16)}`)

                const oldCursor = cursor
                cursor += facegroupOffset
                const faces = parseFaceGroup()
                self.faces = self.faces.concat(faces)
                cursor = oldCursor
                break
            }
            default:
                throw new Error(`Unknown BSP node type 0x${nodeType.toString(16)}`)
            }
        }

        // Load faces
        var cursor = facesAddress

        if (dv.getUint8(cursor) == FaceCmd.TriangleList)
        {
            cursor++
            parseTriangleList() // Ignored
        }

        if (dv.getUint8(cursor) == FaceCmd.FaceGroup)
        {
            cursor++
            const faces = parseFaceGroup()
            self.faces = self.faces.concat(faces)
        }
        else if (dv.getUint8(cursor) == FaceCmd.BSPTree)
        {
            cursor++
            parseBSPNode()
        }
    }

    loadFrame(frame: number)
    {
        const dv = new DataView(this.rom)

        // Assume a static model. These values are changed if an animated model is detected.
        this.curFrame = 0
        this.numFrames = 1

        this.vertices = []
        var cursor = this.verticesAddress
        var done = false
        while (!done)
        {
            const type = dv.getUint8(cursor)
            cursor++

            switch (type)
            {
            case VertexCmd.Plain:
            {
                const num = dv.getUint8(cursor)
                cursor++
                for (let i = 0; i < num; i++)
                {
                    const x = dv.getInt8(cursor)
                    cursor++
                    const y = dv.getInt8(cursor)
                    cursor++
                    const z = dv.getInt8(cursor)
                    cursor++

                    this.vertices.push(x, y, z)
                }
                break
            }
            case VertexCmd.End:
                done = true
                break
            case VertexCmd.AnimatedList:
            {
                this.numFrames = dv.getUint8(cursor)
                cursor++

                this.curFrame = clamp(frame, 0, this.numFrames - 1)

                // Jump to frame
                cursor += frame * 2
                const frameOffset = dv.getUint16(cursor, true)
                cursor += frameOffset + 1

                break
            }
            case VertexCmd.Jump:
            {
                const offset = dv.getUint16(cursor, true) // FIXME: signed?
                cursor += offset + 1
                break
            }
            case VertexCmd.XFlipped:
            {
                const num = dv.getUint8(cursor)
                cursor++
                for (let i = 0; i < num; i++)
                {
                    const x = dv.getInt8(cursor)
                    cursor++
                    const y = dv.getInt8(cursor)
                    cursor++
                    const z = dv.getInt8(cursor)
                    cursor++

                    this.vertices.push(x, y, z)
                    this.vertices.push(-x, y, z)
                }
                break
            }
            default:
                throw new Error(`Unknown vertex entry type 0x${type.toString(16)}`)
            }
        }
    }

    render(modelMatrix: mat4, viewProjMatrix: mat4)
    {
        gl.useProgram(this.shader.program)

        gl.uniformMatrix4fv(this.shader.uModelMatrix, false, modelMatrix)
        gl.uniformMatrix4fv(this.shader.uViewProjMatrix, false, viewProjMatrix)

        for (let i = 0; i < this.faces.length; i++)
        {
            const face = this.faces[i]

            const vertexData = []
            for (let j = 0; j < face.verts.length; j++)
            {
                const v = face.verts[j]
                vertexData.push(this.vertices[v * 3])
                vertexData.push(this.vertices[v * 3 + 1])
                vertexData.push(this.vertices[v * 3 + 2])
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData), gl.STREAM_DRAW)
            gl.enableVertexAttribArray(this.shader.aPosition)
            gl.vertexAttribPointer(this.shader.aPosition, 3, gl.FLOAT, false, 0, 0)

            gl.drawArrays(gl.TRIANGLE_FAN, 0, face.numVerts)
        }
    }
}

class SFXViewer
{
    sfxObject: SFXObject
    modelMatrix: mat4 = mat4.create()

    constructor()
    {

    }

    loadRom(rom: ArrayBuffer)
    {
        console.log(`Loading ROM...`)
    
        // Note: Many sources assume there is a 0x200-byte padding at the beginning of the ROM.
        // TODO: Detect and handle this padding.

        // Big high poly Arwing
        //this.sfxObject = new SFXObject(rom, 0x66001, 0x66042)
        // Andross face morph
        this.sfxObject = new SFXObject(rom, 0x7E29E, 0x7E886)
        // Andross sucking
        //this.sfxObject = new SFXObject(rom, 0x7EB81, 0x7F05B)
        // Andross evil face morph
        //this.sfxObject = new SFXObject(rom, 0x8E1FE, 0x8EA22)
        // Helicopter
        //this.sfxObject = new SFXObject(rom, 0x7B193, 0x7B215)


        this.render()
    }

    setModelMatrix(modelMatrix: mat4)
    {
        this.modelMatrix = mat4.clone(modelMatrix)
    }

    render()
    {
        gl.clearColor(0.1, 0.2, 0.3, 1)
        gl.clearDepth(1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.enable(gl.DEPTH_TEST)

        const viewMatrix = mat4.create()
        mat4.translate(viewMatrix, viewMatrix, [0., 0., -150])

        const projMatrix = mat4.create()
        mat4.perspective(projMatrix, 45, canvas.width / canvas.height, 0.01, 10000.0)
        
        const viewProjMatrix = mat4_mul(projMatrix, viewMatrix)

        this.sfxObject.render(this.modelMatrix, viewProjMatrix)
    }
}

var viewer: SFXViewer = null
var horzRotation: number = 0
var vertRotation: number = 0
var lastFrameTime: number = performance.now()

const fileInput = <HTMLInputElement>document.getElementById('file-input')
fileInput.onchange = function (event)
{
    const file = fileInput.files[0]
    console.log(`Loading ${file.name}...`)

    const reader = new FileReader()
    reader.onloadend = function (evt)
    {
        if (evt.target.readyState == FileReader.DONE)
        {
            horzRotation = 0
            vertRotation = 0
            lastFrameTime = performance.now()
            viewer = new SFXViewer()
            viewer.loadRom(reader.result)
            render()
        }
    }

    reader.readAsArrayBuffer(file)
}

function render()
{
    if (viewer)
    {
        var modelMatrix = mat4_mul(
            mat4_rotateX(vertRotation),
            mat4_rotateY(horzRotation)
        )
        // Invert Y and Z axes since SuperFX coordinate system is upside-down and reversed from WebGL.
        modelMatrix = mat4_mul(
            modelMatrix,
            mat4_scale(1, -1, -1)
        )
        viewer.setModelMatrix(modelMatrix)
        viewer.render()
    }
}

var isPointerDown = false
canvas.addEventListener('pointerdown', function (ev) {
    this.setPointerCapture(ev.pointerId)
    isPointerDown = true
})
canvas.addEventListener('pointerup', function (ev) {
    isPointerDown = false
})

canvas.addEventListener('pointermove', function (ev) {
    if (isPointerDown)
    {
        horzRotation += ev.movementX / 75 / Math.PI
        vertRotation += ev.movementY / 75 / Math.PI
        render()
    }
})

const FRAMES_PER_SECOND = 10
const FRAME_MILLIS = 1000 / FRAMES_PER_SECOND

function onFrame(now: number)
{
    if (viewer && viewer.sfxObject)
    {
        const delta = now - lastFrameTime
        if (delta >= FRAME_MILLIS)
        {
            lastFrameTime += FRAME_MILLIS
            viewer.sfxObject.loadFrame((viewer.sfxObject.curFrame + 1) % viewer.sfxObject.numFrames)
            viewer.render()
        }
    }

    window.requestAnimationFrame(onFrame)
}

onFrame(performance.now())