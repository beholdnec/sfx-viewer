console.log('Hello, world!');
var canvas = document.getElementById('main-canvas');
var gl = canvas.getContext('webgl2');
function compileShader(shaderType, source) {
    var shader = gl.createShader(shaderType);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        return null;
    }
    return shader;
}
function compileProgram(vertexShaderSource, fragmentShaderSource) {
    var vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    var fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    var shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(shaderProgram));
        throw ("Failed to initialize shaders");
    }
    return shaderProgram;
}
var SFX_VERTEX_SHADER_SOURCE = "\nprecision mediump float;\n\nattribute vec3 aPosition;\n\nuniform mat4 uModelMatrix;\nuniform mat4 uViewProjMatrix;\n\nvarying vec3 vWorldPosition;\n\nvoid main()\n{\n    vWorldPosition = (uModelMatrix * vec4(aPosition, 1.)).xyz;\n    gl_Position = uViewProjMatrix * vec4(vWorldPosition, 1.);\n}\n";
var SFX_FRAGMENT_SHADER_SOURCE = "\nprecision mediump float;\n\nvarying vec3 vWorldPosition;\n\nvoid main()\n{\n    gl_FragColor = vec4(0., 1., 0., 1.);\n}\n";
var SFXShader = /** @class */ (function () {
    function SFXShader() {
        this.program = compileProgram(SFX_VERTEX_SHADER_SOURCE, SFX_FRAGMENT_SHADER_SOURCE);
        this.aPosition = gl.getAttribLocation(this.program, 'aPosition');
        this.uModelMatrix = gl.getUniformLocation(this.program, 'uModelMatrix');
        this.uViewProjMatrix = gl.getUniformLocation(this.program, 'uViewProjMatrix');
    }
    return SFXShader;
}());
var VertexCmd;
(function (VertexCmd) {
    VertexCmd[VertexCmd["Plain"] = 4] = "Plain";
    VertexCmd[VertexCmd["End"] = 12] = "End";
    VertexCmd[VertexCmd["XFlipped"] = 56] = "XFlipped";
})(VertexCmd || (VertexCmd = {}));
var SFXObject = /** @class */ (function () {
    function SFXObject(rom, verticesOffset, facesOffset) {
        this.numVertices = 0;
        this.shader = new SFXShader();
        var dv = new DataView(rom);
        // Load vertices
        var vertices = [];
        var cursor = verticesOffset;
        var done = false;
        while (!done) {
            var type = dv.getUint8(cursor);
            cursor++;
            switch (type) {
                case VertexCmd.Plain:
                    {
                        var num = dv.getUint8(cursor);
                        cursor++;
                        for (var i = 0; i < num; i++) {
                            var x = dv.getInt8(cursor);
                            cursor++;
                            var y = dv.getInt8(cursor);
                            cursor++;
                            var z = dv.getInt8(cursor);
                            cursor++;
                            vertices.push(x, y, z);
                        }
                        break;
                    }
                case VertexCmd.End:
                    console.log("End of verts");
                    done = true;
                    break;
                case VertexCmd.XFlipped:
                    {
                        var num = dv.getUint8(cursor);
                        cursor++;
                        for (var i = 0; i < num; i++) {
                            var x = dv.getInt8(cursor);
                            cursor++;
                            var y = dv.getInt8(cursor);
                            cursor++;
                            var z = dv.getInt8(cursor);
                            cursor++;
                            vertices.push(x, y, z);
                            vertices.push(-x, y, z);
                        }
                        break;
                    }
                default:
                    throw new Error("Unknown vertex entry type 0x" + type.toString(16));
            }
        }
        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        this.numVertices = vertices.length / 3;
    }
    SFXObject.prototype.render = function () {
        gl.useProgram(this.shader.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.enableVertexAttribArray(this.shader.aPosition);
        gl.vertexAttribPointer(this.shader.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, this.numVertices);
    };
    return SFXObject;
}());
function loadRom(rom) {
    console.log("Loading ROM...");
    gl.clearColor(0.1, 0.2, 0.3, 1);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Note: Many sources assume there is a 0x200-byte padding at the beginning of the ROM.
    // TODO: Detect and handle this padding.
    var sfxObj = new SFXObject(rom, 0x66001, 0x66042);
    sfxObj.render();
}
var fileInput = document.getElementById('file-input');
fileInput.onchange = function (event) {
    var file = fileInput.files[0];
    console.log("Loading " + file.name + "...");
    var reader = new FileReader();
    reader.onloadend = function (evt) {
        if (evt.target.readyState == FileReader.DONE) {
            loadRom(reader.result);
        }
    };
    reader.readAsArrayBuffer(file);
};
