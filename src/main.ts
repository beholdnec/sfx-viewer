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
    vertices: number[] = []
    faces: Face[] = []
    shader: SFXShader

    constructor(rom: ArrayBuffer, verticesOffset: number, facesOffset: number)
    {
        this.shader = new SFXShader()

        const dv = new DataView(rom)

        const self = this

        // Load vertices
        this.vertices = []
        var cursor = verticesOffset
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
                console.log(`End of verts`)
                done = true
                break
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
        cursor = facesOffset

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

    render(modelMatrix: mat4, viewProjMatrix: mat4)
    {
        gl.useProgram(this.shader.program)

        gl.uniformMatrix4fv(this.shader.uModelMatrix, false, modelMatrix)
        gl.uniformMatrix4fv(this.shader.uViewProjMatrix, false, viewProjMatrix)

        const vertexBuffer = gl.createBuffer()

        // TODO: render object
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

            gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData), gl.STREAM_DRAW)
            gl.enableVertexAttribArray(this.shader.aPosition)
            gl.vertexAttribPointer(this.shader.aPosition, 3, gl.FLOAT, false, 0, 0)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, face.numVerts)
        }
    }
}

class SFXViewer
{
    sfxObject: SFXObject

    constructor()
    {

    }

    loadRom(rom: ArrayBuffer)
    {
        console.log(`Loading ROM...`)
    
        // Note: Many sources assume there is a 0x200-byte padding at the beginning of the ROM.
        // TODO: Detect and handle this padding.
        this.sfxObject = new SFXObject(rom, 0x66001, 0x66042)

        this.render(performance.now())
    }

    render(now: number)
    {
        gl.clearColor(0.1, 0.2, 0.3, 1)
        gl.clearDepth(1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        gl.enable(gl.DEPTH_TEST)

        const modelMatrix = mat4_mul(
            mat4_rotateX(now / 1000),
            mat4_rotateY(now / 2000)
        )

        const viewMatrix = mat4.create()
        mat4.translate(viewMatrix, viewMatrix, [0., 0., -150])

        const projMatrix = mat4.create()
        mat4.perspective(projMatrix, 45, canvas.width / canvas.height, 0.01, 10000.0)
        
        const viewProjMatrix = mat4_mul(projMatrix, viewMatrix)

        this.sfxObject.render(modelMatrix, viewProjMatrix)
    }
}

var viewer: SFXViewer = null

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
            viewer = new SFXViewer()
            viewer.loadRom(reader.result)
        }
    }

    reader.readAsArrayBuffer(file)
}

function onFrame(now: number)
{
    if (viewer)
    {
        viewer.render(now)
    }

    window.requestAnimationFrame(onFrame)
}

onFrame(performance.now())