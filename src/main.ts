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

class SFXObject
{
    vertexBuffer: WebGLBuffer
    numVertices: number = 0
    indexBuffer: WebGLBuffer
    numIndices: number = 0
    shader: SFXShader

    constructor(rom: ArrayBuffer, verticesOffset: number, facesOffset: number)
    {
        this.shader = new SFXShader()

        const dv = new DataView(rom)

        // Load vertices
        const vertices = []
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

                    vertices.push(x, y, z)
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

                    vertices.push(x, y, z)
                    vertices.push(-x, y, z)
                }
                break
            }
            default:
                throw new Error(`Unknown vertex entry type 0x${type.toString(16)}`)
            }
        }

        this.vertexBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
        this.numVertices = vertices.length / 3

        // Load faces
        const triangleList = []
        cursor = facesOffset
        done = false
        while (!done)
        {
            const type = dv.getUint8(cursor)
            cursor++

            switch (type)
            {
            case 0x00: // Past end of data. TODO: Don't parse like this. We shouldn't go past the end.
                done = true
                break
            case FaceCmd.FaceGroup:
            {
                var groupDone = false
                while (!groupDone)
                {
                    const numVerts = dv.getUint8(cursor)
                    cursor++
                    if (numVerts >= 0xFE)
                    {
                        console.warn(`End of facegroup marker 0x${numVerts.toString(16)} encountered`)
                        groupDone = true
                        break
                    }

                    const faceId = dv.getUint8(cursor)
                    cursor++
                    const color = dv.getUint8(cursor)
                    cursor++
                    const nx = dv.getUint8(cursor)
                    cursor++
                    const ny = dv.getUint8(cursor)
                    cursor++
                    const nz = dv.getUint8(cursor)
                    cursor++

                    const verts = []
                    for (let i = 0; i < numVerts; i++)
                    {
                        verts.push(dv.getUint8(cursor))
                        cursor++
                    }

                    console.log(`Facegroup: num verts ${numVerts}; face id ${faceId}; color ${color}; n ${nx},${ny},${nz}; verts ${verts}`)
                }
                break
            }
            case FaceCmd.TriangleList:
            {
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

                    triangleList.push(tri0, tri1, tri2)
                }
                break
            }
            case FaceCmd.BSPTree:
            {
                const parseNode = function ()
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

                        const backNode = parseNode()
                        if (frontBranchOffset == 0)
                            throw new Error(`Front branch offset = 0 detected; breakage imminent!`)
                        const frontNode = parseNode()
                        break
                    }
                    case NodeType.Leaf:
                    {
                        const facegroupOffset = dv.getUint16(cursor, true)
                        cursor += 2
                        console.log(`Leaf: facegroup 0x${facegroupOffset.toString(16)}`)
                        break
                    }
                    default:
                        throw new Error(`Unknown BSP node type 0x${nodeType.toString(16)}`)
                    }
                }

                console.log(`BSP Tree:`)
                parseNode()

                break
            }
            default:
                throw new Error(`Unknown face entry type 0x${type.toString(16)}`)
            }
        }

        this.indexBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(triangleList), gl.STATIC_DRAW)
        this.numIndices = triangleList.length
    }

    render(modelMatrix: mat4, viewProjMatrix: mat4)
    {
        gl.useProgram(this.shader.program)

        gl.uniformMatrix4fv(this.shader.uModelMatrix, false, modelMatrix)
        gl.uniformMatrix4fv(this.shader.uViewProjMatrix, false, viewProjMatrix)

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
        gl.enableVertexAttribArray(this.shader.aPosition)
        gl.vertexAttribPointer(this.shader.aPosition, 3, gl.FLOAT, false, 0, 0)

        //gl.drawArrays(gl.POINTS, 0, this.numVertices)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
        gl.drawElements(gl.TRIANGLES, this.numIndices, gl.UNSIGNED_BYTE, 0)
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