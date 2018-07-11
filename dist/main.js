console.log('Hello, world!');
var canvas = document.getElementById('main-canvas');
var gl = canvas.getContext('webgl2');
var VertexCmd;
(function (VertexCmd) {
    VertexCmd[VertexCmd["Plain"] = 4] = "Plain";
    VertexCmd[VertexCmd["End"] = 12] = "End";
    VertexCmd[VertexCmd["XFlipped"] = 56] = "XFlipped";
})(VertexCmd || (VertexCmd = {}));
var SFXObject = /** @class */ (function () {
    function SFXObject(rom, verticesOffset, facesOffset) {
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
    }
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
