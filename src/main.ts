import { mat3, mat4, vec2, vec3, vec4 } from 'gl-matrix'
import { SFXObject, SFXShader } from './sfxobject'
import { Starfield } from './starfield'
import * as util from './util'

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

class Torus
{
    vertexBuffer: WebGLBuffer = gl.createBuffer()
    indexBuffer: WebGLBuffer = gl.createBuffer()
    numIndices: number = 0
    shader: SFXShader = new SFXShader(gl)

    constructor(radius: number, steps: number, tubeRadius: number, tubeSteps: number)
    {
        // Build a torus model. This could be more efficient, but it works and I'm happy with it.
        const vertices = []
        const indices = []
        var i = 0
        this.numIndices = 0
        for (let s = 0; s < steps; s++)
        {
            const angle = s * 2 * Math.PI / (steps - 1)
            const c = vec3.fromValues(radius * Math.cos(angle), radius * Math.sin(angle), 0)
            for (let t = 0; t < tubeSteps; t++)
            {
                const tubeAngle = t * 2 * Math.PI / (tubeSteps - 1)
                const n = vec3.fromValues(Math.cos(tubeAngle), 0, Math.sin(tubeAngle))
                vec3.rotateZ(n, n, [0, 0, 0], angle)
                const p = util.vec3_scaleAndAdd(c, n, tubeRadius)
                vertices.push(p[0], p[1], p[2]) // position
                vertices.push(n[0], n[1], n[2]) // normal
                if (s > 0 && t > 0) {
                    indices.push(
                        i,
                        i - 1,
                        i - tubeSteps,
                        i - 1,
                        i - tubeSteps,
                        i - tubeSteps - 1
                    )
                    this.numIndices += 6
                }
                i++
            }
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW)
    }

    render(modelMatrix: mat4, viewProjMatrix: mat4)
    {
        gl.enable(gl.DEPTH_TEST)

        gl.useProgram(this.shader.program)

        gl.uniformMatrix4fv(this.shader.uModelMatrix, false, modelMatrix)
        gl.uniformMatrix3fv(this.shader.uNormalMatrix, false, util.mat3_normalFromMat4(modelMatrix))
        gl.uniformMatrix4fv(this.shader.uViewProjMatrix, false, viewProjMatrix)

        gl.uniform3fv(this.shader.uEye, [0, 0, 0]) // TODO
        gl.uniform4fv(this.shader.uColor, [0, 1, 0, 1])

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
        gl.enableVertexAttribArray(this.shader.aPosition)
        gl.vertexAttribPointer(this.shader.aPosition, 3, gl.FLOAT, false, 4 * 6, 0)
        gl.enableVertexAttribArray(this.shader.aNormal)
        gl.vertexAttribPointer(this.shader.aNormal, 3, gl.FLOAT, false, 4 * 6, 4 * 3)

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
        gl.drawElements(gl.TRIANGLES, this.numIndices, gl.UNSIGNED_SHORT, 0)
        //gl.drawArrays(gl.POINTS, 0, this.numVertices)
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

// Proportional-integral-derivative controller
class PIDController
{
    Kp: number = 0
    Ki: number = 0
    Kd: number = 0
    integral: number = 0
    previousError: number = 0

    constructor(Kp: number, Ki: number, Kd: number)
    {
        this.Kp = Kp
        this.Ki = Ki
        this.Kd = Kd
    }

    advance(delta: number, current: number, target: number): number
    {
        const e = target - current
        this.integral += e * delta
        const derivative = (e - this.previousError) / delta
        this.previousError = e // TODO: apply filtering to derivative and integral?

        return this.Kp * e + this.Ki * this.integral + this.Kd * derivative
    }
}

class SFXViewer
{
    gl: WebGLRenderingContext
    rom: ArrayBuffer
    sfxObject: SFXObject
    modelMatrix: mat4 = mat4.create()
    pendingDelta = 0 // pending delta in seconds. the simulation runs in discrete steps. this variable tracks the pending time after the last step.
    DELTA_STEP = 1 / 120 // size of delta step in seconds

    pitch: number = 0
    targetPitch: number = 0
    pitchVelocity: number = 0 // pitch velocity in radians per second
    pitchAcceleration: number = 0 // pitch acceleration in radians per second^2
    pitchPid: PIDController = new PIDController(30, 0, 10) // Numbers found through experimentation
    MAX_PITCH_ACCELERATION: number = Math.PI * 4
    
    yaw: number = 0
    targetYaw: number = 0
    yawVelocity: number = 0
    yawAcceleration: number = 0
    yawPid: PIDController = new PIDController(30, 0, 10)
    MAX_YAW_ACCELERATION: number = Math.PI * 4

    constructor(gl: WebGLRenderingContext)
    {
        this.gl = gl
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
        const gl = this.gl

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
            this.sfxObject = new SFXObject(gl, this.rom, verticesAddress, facesAddress)
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

    setTargetYaw(targetYaw: number)
    {
        this.targetYaw = targetYaw
    }

    setTargetPitch(targetPitch: number)
    {
        this.targetPitch = targetPitch
    }

    advance(delta: number)
    {
        this.pendingDelta += delta / 1000
        while (this.pendingDelta >= this.DELTA_STEP)
        {
            this.pitchAcceleration = this.pitchPid.advance(this.DELTA_STEP, this.pitch, this.targetPitch)
            this.pitchAcceleration = util.clamp(this.pitchAcceleration, -this.MAX_PITCH_ACCELERATION, this.MAX_PITCH_ACCELERATION)

            this.pitchVelocity += this.pitchAcceleration * this.DELTA_STEP
            this.pitch += this.pitchVelocity * this.DELTA_STEP

            this.yawAcceleration = this.yawPid.advance(this.DELTA_STEP, this.yaw, this.targetYaw)
            this.yawAcceleration = util.clamp(this.yawAcceleration, -this.MAX_YAW_ACCELERATION, this.MAX_YAW_ACCELERATION)

            this.yawVelocity += this.yawAcceleration * this.DELTA_STEP
            this.yaw += this.yawVelocity * this.DELTA_STEP

            this.pendingDelta -= this.DELTA_STEP
        }
    }

    render()
    {
        if (this.sfxObject)
        {
            gl.enable(gl.DEPTH_TEST)
            gl.lineWidth(8.0)

            const viewMatrix = mat4.create()
            mat4.translate(viewMatrix, viewMatrix, [0., 0., -150])

            const projMatrix = mat4.create()
            mat4.perspective(projMatrix, 45, canvas.width / canvas.height, 0.01, 10000.0)
            
            const viewProjMatrix = util.mat4_mul(projMatrix, viewMatrix)

            const modelMatrix = mat4.clone(this.modelMatrix)
            mat4.rotateY(modelMatrix, modelMatrix, this.yaw)
            mat4.rotateX(modelMatrix, modelMatrix, this.pitch)

            this.sfxObject.render(modelMatrix, viewProjMatrix)
        }
    }
}

const INITIAL_MODEL_NUMBER = 10
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
            viewer = new SFXViewer(gl)
            viewer.loadRom(reader.result)
            const headerAddress = SF1_OBJECT_LIST_ADDRESS + SF1_OBJECT_HEADER_LENGTH * modelNumber
            viewer.loadObject(headerAddress)
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

const starfield = new Starfield(gl)
const torus = new Torus(3, 100, 1, 100)

function render()
{
    gl.clearColor(0, 0, 0, 1)
    gl.clearDepth(1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    // Render starfield
    starfield.render()
    
    // Render torus
    gl.clear(gl.DEPTH_BUFFER_BIT)
    var modelMatrix = mat4.create()
    mat4.rotateY(modelMatrix, modelMatrix, (performance.now() % 2000) / 2000 * 2 * Math.PI)
    const viewMatrix = mat4.create()
    mat4.translate(viewMatrix, viewMatrix, [0., 0., -10])
    const projMatrix = mat4.create()
    mat4.perspective(projMatrix, 45, canvas.width / canvas.height, 0.01, 10000.0)
    const viewProjMatrix = util.mat4_mul(projMatrix, viewMatrix)
    torus.render(modelMatrix, viewProjMatrix)

    // Render model if loaded
    if (viewer)
    {
        gl.clear(gl.DEPTH_BUFFER_BIT)
        var modelMatrix = util.mat4_mul(
            util.mat4_rotateX(vertRotation),
            util.mat4_rotateY(horzRotation)
        )
        // Invert Y and Z axes since SuperFX coordinate system is upside-down and reversed from WebGL.
        modelMatrix = util.mat4_mul(
            modelMatrix,
            util.mat4_scale(1, -1, -1)
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

const pressedKeys = {}
window.addEventListener('keydown', function (ev) {
    pressedKeys[ev.keyCode] = true
})
window.addEventListener('keyup', function (ev) {
    pressedKeys[ev.keyCode] = false
})

const pidCanvas = <HTMLCanvasElement>document.getElementById('pid-canvas')
const pid2d = pidCanvas.getContext('2d')
const pidkp = <HTMLInputElement>document.getElementById('pid-kp')
const pidki = <HTMLInputElement>document.getElementById('pid-ki')
const pidkd = <HTMLInputElement>document.getElementById('pid-kd')

function drawPid()
{
    pidCanvas.width = pidCanvas.width // Reset the canvas and all parameters

    const Kp = pidkp.valueAsNumber
    const Ki = pidki.valueAsNumber
    const Kd = pidkd.valueAsNumber

    const PID_SAMPLES = 60 * 4
    const PID_DELTA = 1 / 60
    pid2d.save()
    pid2d.scale(pidCanvas.width / PID_SAMPLES, pidCanvas.height / -10)
    pid2d.translate(0, -5)

    const MAX_YAW_ACCELERATION = Math.PI * 4
    const targetYaw = Math.PI / 3
    var currentYaw = 0
    var currentYawVelocity = 0
    var currentYawAcceleration = 0
    var yawErrorIntegral = 0
    var yawPreviousError = 0

    // Draw target
    pid2d.strokeStyle = 'red'
    // TODO: draw in red. strokeStyle is clobbered later.
    pid2d.moveTo(0, targetYaw)
    pid2d.lineTo(PID_SAMPLES, targetYaw)

    // Draw yaw graph
    pid2d.strokeStyle = 'black'
    pid2d.moveTo(0, 0)
    for (let i = 0; i < PID_SAMPLES; i++)
    {
        // Control the ship with a crude PID controller
        // TODO: step by fixed deltas; be more robust in varying framerates
        const e = targetYaw - currentYaw
        yawErrorIntegral += e * PID_DELTA
        const derivative = (e - yawPreviousError) / PID_DELTA

        currentYawAcceleration = Kp * e + Ki * yawErrorIntegral + Kd * derivative
        currentYawAcceleration = util.clamp(currentYawAcceleration, -MAX_YAW_ACCELERATION, MAX_YAW_ACCELERATION)

        yawPreviousError = e

        currentYawVelocity += currentYawAcceleration * PID_DELTA
        currentYaw += currentYawVelocity * PID_DELTA

        pid2d.lineTo(i, currentYaw)
    }
    pid2d.restore()
    pid2d.stroke()
}

const FRAMES_PER_SECOND = 10
const FRAME_MILLIS = 1000 / FRAMES_PER_SECOND
const MAX_DELTA = 2000
var pendingAnimDelta = 0

function advance(delta: number)
{
    if (delta >= MAX_DELTA)
    {
        // Too much lag; resync frame timer
        lastFrameTime += delta - MAX_DELTA
        delta = MAX_DELTA
    }

    if (viewer)
    {
        const heading = vec3.fromValues(0, 0, 1)
        vec3.rotateX(heading, heading, [0, 0, 0], viewer.pitch)
        vec3.rotateY(heading, heading, [0, 0, 0], -viewer.yaw)
        starfield.advance(delta, heading)
    }
    else
    {
        starfield.advance(delta, vec3.fromValues(0, 0, 1))
    }

    if (viewer && viewer.sfxObject)
    {
        pendingAnimDelta += delta
        while (pendingAnimDelta >= FRAME_MILLIS)
        {
            viewer.sfxObject.loadFrame((viewer.sfxObject.curFrame + 1) % viewer.sfxObject.numFrames)
            pendingAnimDelta -= FRAME_MILLIS
        }

        var vertDir = 0
        var horzDir = 0
        if (pressedKeys['W'.charCodeAt(0)])
            vertDir -= 1
        if (pressedKeys['S'.charCodeAt(0)])
            vertDir += 1
        if (pressedKeys['A'.charCodeAt(0)])
            horzDir -= 1
        if (pressedKeys['D'.charCodeAt(0)])
            horzDir += 1

        viewer.setTargetYaw(Math.PI / 6 * horzDir)
        viewer.setTargetPitch(Math.PI / 3 * vertDir)
        viewer.advance(delta)
    }

    lastFrameTime += delta
}

function onFrame(now: number)
{
    advance(now - lastFrameTime)
    render()
    drawPid()

    window.requestAnimationFrame(onFrame)
}

onFrame(performance.now())