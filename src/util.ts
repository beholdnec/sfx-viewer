import { mat3, mat4, vec3 } from 'gl-matrix'

export function clamp(a: number, lo: number, hi: number)
{
    if (a < lo)
        return lo
    else if (a > hi)
        return hi
    else
        return a
}

export function mix(x: number, y: number, a: number)
{
    return x * (1 - a) + y * a
}

export function mat4_mul(a: mat4, b: mat4)
{
    const result = mat4.create()
    mat4.mul(result, a, b)
    return result
}

export function mat4_invert(a: mat4)
{
    const result = mat4.create()
    mat4.invert(result, a)
    return result
}

export function mat3_normalFromMat4(a: mat4)
{
    const result = mat3.create()
    mat3.normalFromMat4(result, a)
    return result
}

export function mat4_rotateX(rad: number)
{
    const result = mat4.create()
    mat4.rotateX(result, mat4.create(), rad)
    return result
}

export function mat4_rotateY(rad: number)
{
    const result = mat4.create()
    mat4.rotateY(result, mat4.create(), rad)
    return result
}

export function mat4_rotateZ(rad: number)
{
    const result = mat4.create()
    mat4.rotateZ(result, mat4.create(), rad)
    return result
}

export function mat4_scale(x: number, y: number, z: number)
{
    const result = mat4.create()
    mat4.fromScaling(result, [x, y, z])
    return result
}

export function mat4_transpose(a: mat4)
{
    const result = mat4.create()
    mat4.transpose(result, a)
    return result
}

export function vec3_scaleAndAdd(a: vec3, b: vec3, scale: number)
{
    const result = vec3.create()
    vec3.scaleAndAdd(result, a, b, scale)
    return result
}

export function compileShader(gl: WebGLRenderingContext, shaderType: number, source: string): WebGLShader
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

export function compileProgram(gl: WebGLRenderingContext, vertexShaderSource: string, fragmentShaderSource: string): WebGLProgram
{
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)

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