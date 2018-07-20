import { mat4, vec3, vec4 } from 'gl-matrix'
import * as util from './util'

interface Star
{
    point: vec3
    color: vec4
}

const STARFIELD_VERTEX_SHADER_SOURCE =
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
    gl_PointSize = 4.;
}
`

const STARFIELD_FRAGMENT_SHADER_SOURCE =
`
precision mediump float;

varying vec3 vWorldPosition;

uniform vec3 uEye; // Currently unused
uniform vec4 uColor;

void main()
{
    gl_FragColor = uColor;
}
`

class StarfieldShader
{
    program: WebGLProgram
    aPosition: number
    uModelMatrix: WebGLUniformLocation
    uViewProjMatrix: WebGLUniformLocation
    uEye: WebGLUniformLocation
    uColor: WebGLUniformLocation

    constructor(gl: WebGLRenderingContext)
    {
        this.program = util.compileProgram(gl, STARFIELD_VERTEX_SHADER_SOURCE, STARFIELD_FRAGMENT_SHADER_SOURCE)

        this.aPosition = gl.getAttribLocation(this.program, 'aPosition')
        this.uModelMatrix = gl.getUniformLocation(this.program, 'uModelMatrix')
        this.uViewProjMatrix = gl.getUniformLocation(this.program, 'uViewProjMatrix')
        this.uEye = gl.getUniformLocation(this.program, 'uEye')
        this.uColor = gl.getUniformLocation(this.program, 'uColor')
    }
}

export class Starfield
{
    gl: WebGLRenderingContext
    shader: StarfieldShader
    stars: Star[] = []
    pendingDelta = 0 // pending delta in seconds. the simulation runs in discrete steps. this variable tracks the pending time after the last step.
    DELTA_STEP = 1 / 120 // size of delta step in seconds
    MAX_STARS = 1000

    constructor(gl: WebGLRenderingContext)
    {
        this.gl = gl
        this.shader = new StarfieldShader(gl)
    }

    advance(delta: number, heading: vec3)
    {
        this.pendingDelta += delta / 1000
        while (this.pendingDelta >= this.DELTA_STEP)
        {
            // Move existing stars
            for (let i = 0; i < this.stars.length; i++)
            {
                this.stars[i].point = util.vec3_scaleAndAdd(this.stars[i].point, heading, this.DELTA_STEP)
            }

            // Retire old stars
            for (let i = 0; i < this.stars.length;)
            {
                if (this.stars[i].point[2] > 1)
                {
                    this.stars.splice(i, 1)
                }
                else
                {
                    i++
                }
            }

            // Spawn new stars
            for (let i = 0; i < 4; i++)
            {
                if (this.stars.length >= this.MAX_STARS)
                    break

                if (Math.random() <= 0.1)
                {
                    this.stars.push({
                        point: vec3.fromValues(Math.random() * 2 - 1, Math.random() * 2 - 1, 0),
                        color: vec4.fromValues(1, 1, 1, 1)
                    })
                }
            }

            this.pendingDelta -= this.DELTA_STEP
        }
    }

    render()
    {
        const gl = this.gl
        gl.disable(gl.DEPTH_TEST)

        gl.useProgram(this.shader.program)

        gl.uniformMatrix4fv(this.shader.uModelMatrix, false, mat4.create())

        const viewMatrix = mat4.create()
        mat4.translate(viewMatrix, viewMatrix, [0., 0., -2.])

        const projMatrix = mat4.create()
        mat4.perspective(projMatrix, 45, gl.canvas.width / gl.canvas.height, 0, 1)
        
        const viewProjMatrix = util.mat4_mul(projMatrix, viewMatrix)
        gl.uniformMatrix4fv(this.shader.uViewProjMatrix, false, viewProjMatrix)

        gl.uniform3fv(this.shader.uEye, [0, 0, 0])
        gl.uniform4fv(this.shader.uColor, [1, 1, 1, 1])

        gl.disableVertexAttribArray(this.shader.aPosition)
        gl.bindBuffer(gl.ARRAY_BUFFER, null)
        for (let i = 0; i < this.stars.length; i++)
        {
            gl.vertexAttrib3fv(this.shader.aPosition, this.stars[i].point)
            gl.drawArrays(gl.POINTS, 0, 1)
        }
    }
}