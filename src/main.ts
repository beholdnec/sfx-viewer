import { mat3, mat4 } from 'gl-matrix'

console.log('Hello, world!')

const canvas = <HTMLCanvasElement>document.getElementById('main-canvas')
const desiredWidth = canvas.width
const desiredHeight = canvas.height
canvas.setAttribute('style', `width: ${desiredWidth}px; height: ${desiredHeight}px`)
const devicePixelRatio = window.devicePixelRatio || 1
canvas.width = desiredWidth * devicePixelRatio
canvas.height = desiredHeight * devicePixelRatio

// Get GL context AFTER resizing canvas, otherwise the viewport is wrong.
const gl = <WebGL2RenderingContext>canvas.getContext('webgl')

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

function mat4_invert(a: mat4)
{
    const result = mat4.create()
    mat4.invert(result, a)
    return result
}

function mat3_normalFromMat4(a: mat4)
{
    const result = mat3.create()
    mat3.normalFromMat4(result, a)
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

function mat4_transpose(a: mat4)
{
    const result = mat4.create()
    mat4.transpose(result, a)
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
`
precision mediump float;

attribute vec3 aPosition;
attribute vec3 aNormal;

uniform mat4 uModelMatrix;
uniform mat3 uNormalMatrix;
uniform mat4 uViewProjMatrix;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main()
{
    vWorldPosition = (uModelMatrix * vec4(aPosition, 1.)).xyz;
    vWorldNormal = uNormalMatrix * aNormal;
    gl_Position = uViewProjMatrix * vec4(vWorldPosition, 1.);
    gl_PointSize = 4.;
}
`

const SFX_FRAGMENT_SHADER_SOURCE =
`
precision mediump float;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

uniform vec3 uEye; // Currently unused
uniform vec4 uColor;

void main()
{
    vec3 incident = vec3(0., 0., -1.);
    vec3 L = normalize(-incident);
    vec3 N = normalize(vWorldNormal);
    float NdotL = clamp(dot(N, L), 0., 1.);
    gl_FragColor = vec4(NdotL * uColor.rgb, uColor.a);
}
`

class SFXShader
{
    aPosition: number
    aNormal: number
    uModelMatrix: WebGLUniformLocation
    uNormalMatrix: WebGLUniformLocation
    uViewProjMatrix: WebGLUniformLocation
    uEye: WebGLUniformLocation
    uColor: WebGLUniformLocation

    program: WebGLProgram

    constructor()
    {
        this.program = compileProgram(SFX_VERTEX_SHADER_SOURCE, SFX_FRAGMENT_SHADER_SOURCE)

        this.aPosition = gl.getAttribLocation(this.program, 'aPosition')
        this.aNormal = gl.getAttribLocation(this.program, 'aNormal')
        this.uModelMatrix = gl.getUniformLocation(this.program, 'uModelMatrix')
        this.uNormalMatrix = gl.getUniformLocation(this.program, 'uNormalMatrix')
        this.uViewProjMatrix = gl.getUniformLocation(this.program, 'uViewProjMatrix')
        this.uEye = gl.getUniformLocation(this.program, 'uEye')
        this.uColor = gl.getUniformLocation(this.program, 'uColor')
    }
}

enum VertexCmd
{
    Plain = 0x04,
    Plain16 = 0x08,
    End = 0x0C,
    AnimatedList = 0x1C,
    Jump = 0x20,
    XFlipped16 = 0x34,
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

        console.log(`${this.vertices.length / 3} vertices loaded`)

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
                face.nx = dv.getInt8(cursor)
                cursor++
                face.ny = dv.getInt8(cursor)
                cursor++
                face.nz = dv.getInt8(cursor)
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

        console.log(`${this.faces.length} faces loaded`)
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
            case VertexCmd.Plain16:
            {
                const num = dv.getUint8(cursor)
                cursor++
                for (let i = 0; i < num; i++)
                {
                    const x = dv.getInt16(cursor, true)
                    cursor += 2
                    const y = dv.getInt16(cursor, true)
                    cursor += 2
                    const z = dv.getInt16(cursor, true)
                    cursor += 2

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
                cursor += this.curFrame * 2
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
            case VertexCmd.XFlipped16:
            {
                const num = dv.getUint8(cursor)
                cursor++
                for (let i = 0; i < num; i++)
                {
                    const x = dv.getInt16(cursor, true)
                    cursor += 2
                    const y = dv.getInt16(cursor, true)
                    cursor += 2
                    const z = dv.getInt16(cursor, true)
                    cursor += 2

                    this.vertices.push(x, y, z)
                    this.vertices.push(-x, y, z)
                }
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
        gl.uniformMatrix3fv(this.shader.uNormalMatrix, false, mat3_normalFromMat4(modelMatrix))
        gl.uniformMatrix4fv(this.shader.uViewProjMatrix, false, viewProjMatrix)

        // TODO: Draw faces with correct colors
        gl.uniform4fv(this.shader.uColor, [1, 1, 1, 1])

        if (this.faces.length > 0)
        {
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

                // Face normals seem to be inverted; correct them here.
                // TODO: Program more carefully to avoid strange issues like this. For instance,
                // this is probably the result of using the wrong matrices.
                gl.vertexAttrib3fv(this.shader.aNormal, [-face.nx, -face.ny, -face.nz])

                if (face.numVerts >= 3)
                    gl.drawArrays(gl.TRIANGLE_FAN, 0, face.numVerts)
                else if (face.numVerts == 2)
                    gl.drawArrays(gl.LINES, 0, 2)
                else
                    gl.drawArrays(gl.POINTS, 0, 1)
            }
        }
        else
        {
            // No faces defined; draw points
            // TODO: Disable lighting
            gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.STREAM_DRAW)
            gl.enableVertexAttribArray(this.shader.aPosition)
            gl.vertexAttribPointer(this.shader.aPosition, 3, gl.FLOAT, false, 0, 0)

            gl.drawArrays(gl.POINTS, 0, this.vertices.length / 3)
        }
    }
}

// These are addresses of object header arrays. I don't know whether these are separate arrays or
// or one big array that is being interpreted wrongly.
//const SF1_OBJECT_LIST_ADDRESS = 0x2C15
//const SF1_OBJECT_LIST_ADDRESS = 0x34DF
//const SF1_OBJECT_LIST_ADDRESS = 0x38DB
const SF1_OBJECT_LIST_ADDRESS = 0x3B80
//const SF1_OBJECT_LIST_ADDRESS = 0x5898
const SF1_OBJECT_HEADER_LENGTH = 0x1C

class SFXViewer
{
    rom: ArrayBuffer
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

        this.rom = rom

        // Big high poly Arwing
        //this.sfxObject = new SFXObject(rom, 0x66001, 0x66042)
        // Phantron transformation
        //this.sfxObject = new SFXObject(rom, 0x75916, 0x75F42)
        // Andross face morph
        //this.sfxObject = new SFXObject(rom, 0x7E29E, 0x7E886)
        // Andross sucking
        //this.sfxObject = new SFXObject(rom, 0x7EB81, 0x7F05B)
        // Andross evil face morph
        //this.sfxObject = new SFXObject(rom, 0x8E1FE, 0x8EA22)
        // Helicopter
        //this.sfxObject = new SFXObject(rom, 0x7B193, 0x7B215)
    }

    loadObject(headerAddress: number)
    {
        const dv = new DataView(this.rom)

        // The ROM is divided into banks of 0x8000 bytes each. These banks are mapped onto the SNES
        // bus with a fairly complex formula (LoROM). Fortunately, this field simply specifies the
        // ROM bank, so there is no need to worry about SNES memory mapping.
        const bank = dv.getUint8(headerAddress + 2)
        // ??? I don't know why we use "bank - 1" instead of just "bank". Possibly because bank "0"
        // marks a null object.
        if (bank != 0)
        {
            const verticesAddress = (0x8000 * (bank - 1)) + dv.getUint16(headerAddress, true)
            const facesAddress = (0x8000 * (bank - 1)) + dv.getUint16(headerAddress + 3, true)

            console.log(`Loading from verts address 0x${verticesAddress.toString(16)}; faces address 0x${facesAddress.toString(16)}`)
            this.sfxObject = new SFXObject(this.rom, verticesAddress, facesAddress)
        }
        else
        {
            console.warn(`No object found at header address 0x${headerAddress.toString(16)}`)
            this.sfxObject = null
        }
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

        if (this.sfxObject)
        {
            gl.enable(gl.DEPTH_TEST)
            gl.lineWidth(8.0)

            const viewMatrix = mat4.create()
            mat4.translate(viewMatrix, viewMatrix, [0., 0., -150])

            const projMatrix = mat4.create()
            mat4.perspective(projMatrix, 45, canvas.width / canvas.height, 0.01, 10000.0)
            
            const viewProjMatrix = mat4_mul(projMatrix, viewMatrix)

            this.sfxObject.render(this.modelMatrix, viewProjMatrix)
        }
    }
}

const INITIAL_MODEL_NUMBER = 76
var viewer: SFXViewer = null
var horzRotation: number = 0
var vertRotation: number = 0
var modelNumber: number = INITIAL_MODEL_NUMBER
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
            modelNumber = INITIAL_MODEL_NUMBER
            lastFrameTime = performance.now()
            viewer = new SFXViewer()
            viewer.loadRom(<ArrayBuffer>reader.result)
            render()
        }
    }

    reader.readAsArrayBuffer(file)
}

const modelNum = <HTMLInputElement>document.getElementById('model-num')
modelNum.onchange = function (ev)
{
    if (viewer)
    {
        modelNumber = modelNum.valueAsNumber
        horzRotation = 0
        vertRotation = 0
        lastFrameTime = performance.now()
        const headerAddress = SF1_OBJECT_LIST_ADDRESS + SF1_OBJECT_HEADER_LENGTH * modelNumber
        viewer.loadObject(headerAddress)
        render()
    }
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
const MAX_DELTA = 2000

function advance(delta_: number)
{
    if (viewer && viewer.sfxObject)
    {
        if (delta_ >= MAX_DELTA)
        {
            // Too much lag; resync frame timer
            lastFrameTime += delta_ - MAX_DELTA
        }

        var delta = clamp(delta_, 0, MAX_DELTA)
        while (delta >= FRAME_MILLIS)
        {
            delta -= FRAME_MILLIS
            lastFrameTime += FRAME_MILLIS
            viewer.sfxObject.loadFrame((viewer.sfxObject.curFrame + 1) % viewer.sfxObject.numFrames)
        }

        viewer.render()
    }
}

function onFrame(now: number)
{
    advance(now - lastFrameTime)

    window.requestAnimationFrame(onFrame)
}

onFrame(performance.now())