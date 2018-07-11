console.log('Hello, world!')

const canvas = <HTMLCanvasElement>document.getElementById('main-canvas')
const gl = <WebGL2RenderingContext>canvas.getContext('webgl2')

enum VertexCmd
{
    Plain = 0x04,
    End = 0x0C,
    XFlipped = 0x38,
}

class SFXObject
{
    constructor(rom: ArrayBuffer, verticesOffset: number, facesOffset: number)
    {
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