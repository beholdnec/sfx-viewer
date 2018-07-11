console.log('Hello, world!')

const canvas = <HTMLCanvasElement>document.getElementById('main-canvas')
const gl = <WebGL2RenderingContext>canvas.getContext('webgl2')

function compileShader(shaderType: number, source: string): WebGLShader
{
    const shader = gl.createShader(shaderType)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    {
        console.error(gl.getShaderInfoLog(shader))
        return null
    }

    return shader
}

function compileProgram(vertexShaderSource: string, fragmentShaderSource: string): WebGLProgram
{
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource)

    const shaderProgram = gl.createProgram()
    gl.attachShader(shaderProgram, vertexShader)
    gl.attachShader(shaderProgram, fragmentShader)
    gl.linkProgram(shaderProgram)

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS))
    {
        console.error(gl.getProgramInfoLog(shaderProgram))
        throw("Failed to initialize shaders")
    }

    return shaderProgram
}

const SFX_VERTEX_SHADER_SOURCE =
`
precision mediump float;

attribute vec3 aPosition;

uniform mat4 uModelMatrix;
uniform mat4 uViewProjMatrix;

varying vec3 vWorldPosition;

void main()
{
    vWorldPosition = (uModelMatrix * vec4(aPosition, 1.)).xyz;
    gl_Position = uViewProjMatrix * vec4(vWorldPosition, 1.);
}
`

const SFX_FRAGMENT_SHADER_SOURCE =
`
precision mediump float;

varying vec3 vWorldPosition;

void main()
{
    gl_FragColor = vec4(0., 1., 0., 1.);
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

class SFXObject
{
    vertexBuffer: WebGLBuffer
    numVertices: number = 0
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
    }

    render()
    {
        gl.useProgram(this.shader.program)

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
        gl.enableVertexAttribArray(this.shader.aPosition)
        gl.vertexAttribPointer(this.shader.aPosition, 3, gl.FLOAT, false, 0, 0)

        gl.drawArrays(gl.POINTS, 0, this.numVertices)
    }
}

function loadRom(rom: ArrayBuffer)
{
    console.log(`Loading ROM...`)

    gl.clearColor(0.1, 0.2, 0.3, 1)
    gl.clearDepth(1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    // Note: Many sources assume there is a 0x200-byte padding at the beginning of the ROM.
    // TODO: Detect and handle this padding.
    const sfxObj = new SFXObject(rom, 0x66001, 0x66042)

    sfxObj.render()
}

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
            loadRom(reader.result)
        }
    }

    reader.readAsArrayBuffer(file)
}