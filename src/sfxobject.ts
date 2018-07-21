import { mat4 } from 'gl-matrix'
import * as util from './util'

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

export class SFXShader
{
    aPosition: number
    aNormal: number
    uModelMatrix: WebGLUniformLocation
    uNormalMatrix: WebGLUniformLocation
    uViewProjMatrix: WebGLUniformLocation
    uEye: WebGLUniformLocation
    uColor: WebGLUniformLocation

    program: WebGLProgram

    constructor(gl: WebGLRenderingContext)
    {
        this.program = util.compileProgram(gl, SFX_VERTEX_SHADER_SOURCE, SFX_FRAGMENT_SHADER_SOURCE)

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

export class SFXObject
{
    rom: ArrayBuffer
    verticesAddress: number = 0
    facesAddress: number = 0
    curFrame: number = 0
    numFrames: number = 0
    vertices: number[] = []
    faces: Face[] = []
    shader: SFXShader

    gl: WebGLRenderingContext
    vertexBuffer: WebGLBuffer

    constructor(gl: WebGLRenderingContext, rom: ArrayBuffer, verticesAddress: number, facesAddress: number)
    {
        this.rom = rom
        this.verticesAddress = verticesAddress
        this.facesAddress = this.facesAddress

        this.gl = gl
        this.shader = new SFXShader(gl)
        this.vertexBuffer = gl.createBuffer()

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

                this.curFrame = util.clamp(frame, 0, this.numFrames - 1)

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
        const gl = this.gl

        gl.enable(gl.DEPTH_TEST)

        gl.useProgram(this.shader.program)

        gl.uniformMatrix4fv(this.shader.uModelMatrix, false, modelMatrix)
        gl.uniformMatrix3fv(this.shader.uNormalMatrix, false, util.mat3_normalFromMat4(modelMatrix))
        gl.uniformMatrix4fv(this.shader.uViewProjMatrix, false, viewProjMatrix)

        gl.uniform3fv(this.shader.uEye, [0, 0, 0]) // TODO
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
                gl.disableVertexAttribArray(this.shader.aNormal)
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