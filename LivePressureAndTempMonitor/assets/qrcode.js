(function () {
  'use strict';

  // Compact QR Model 2 encoder for the short ASCII viewer URLs used here.
  // Versions 1–5, byte mode, error correction level L.
  const versions = [
    { number: 1, dataCodewords: 19, eccCodewords: 7, capacity: 17, alignment: [] },
    { number: 2, dataCodewords: 34, eccCodewords: 10, capacity: 32, alignment: [6, 18] },
    { number: 3, dataCodewords: 55, eccCodewords: 15, capacity: 53, alignment: [6, 22] },
    { number: 4, dataCodewords: 80, eccCodewords: 20, capacity: 78, alignment: [6, 26] },
    { number: 5, dataCodewords: 108, eccCodewords: 26, capacity: 106, alignment: [6, 30] },
  ];

  function appendBits(bits, value, length) {
    for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
  }

  function multiply(a, b) {
    let left = a;
    let right = b;
    let result = 0;
    while (right) {
      if (right & 1) result ^= left;
      left <<= 1;
      if (left & 0x100) left ^= 0x11d;
      right >>>= 1;
    }
    return result;
  }

  function powerOfTwo(exponent) {
    let value = 1;
    for (let index = 0; index < exponent; index += 1) value = multiply(value, 2);
    return value;
  }

  function multiplyPolynomials(left, right) {
    const result = new Array(left.length + right.length - 1).fill(0);
    left.forEach((a, leftIndex) => right.forEach((b, rightIndex) => {
      result[leftIndex + rightIndex] ^= multiply(a, b);
    }));
    return result;
  }

  function errorCorrection(data, count) {
    let generator = [1];
    for (let index = 0; index < count; index += 1) {
      generator = multiplyPolynomials(generator, [1, powerOfTwo(index)]);
    }
    const message = data.concat(new Array(count).fill(0));
    for (let offset = 0; offset < data.length; offset += 1) {
      const factor = message[offset];
      if (!factor) continue;
      generator.forEach((coefficient, index) => {
        message[offset + index] ^= multiply(coefficient, factor);
      });
    }
    return message.slice(data.length);
  }

  function dataCodewords(text, version) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const bits = [];
    appendBits(bits, 0b0100, 4);
    appendBits(bits, bytes.length, 8);
    bytes.forEach((byte) => appendBits(bits, byte, 8));
    const maximumBits = version.dataCodewords * 8;
    for (let index = 0; index < 4 && bits.length < maximumBits; index += 1) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const result = [];
    for (let offset = 0; offset < bits.length; offset += 8) {
      let value = 0;
      for (let index = 0; index < 8; index += 1) value = (value << 1) | bits[offset + index];
      result.push(value);
    }
    let pad = true;
    while (result.length < version.dataCodewords) {
      result.push(pad ? 0xec : 0x11);
      pad = !pad;
    }
    return result;
  }

  function finder(matrix, top, left) {
    const size = matrix.length;
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const y = top + row;
        const x = left + column;
        if (y < 0 || x < 0 || y >= size || x >= size) continue;
        const inside = row >= 0 && row <= 6 && column >= 0 && column <= 6;
        matrix[y][x] = inside && (
          row === 0 || row === 6 || column === 0 || column === 6 ||
          (row >= 2 && row <= 4 && column >= 2 && column <= 4)
        );
      }
    }
  }

  function baseMatrix(version) {
    const size = 17 + version.number * 4;
    const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
    finder(matrix, 0, 0);
    finder(matrix, size - 7, 0);
    finder(matrix, 0, size - 7);

    for (let index = 8; index < size - 8; index += 1) {
      if (matrix[6][index] === null) matrix[6][index] = index % 2 === 0;
      if (matrix[index][6] === null) matrix[index][6] = index % 2 === 0;
    }

    version.alignment.forEach((row) => version.alignment.forEach((column) => {
      if (matrix[row][column] !== null) return;
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          matrix[row + y][column + x] = Math.max(Math.abs(x), Math.abs(y)) === 2 || (x === 0 && y === 0);
        }
      }
    }));
    return matrix;
  }

  function bitLength(value) {
    let length = 0;
    let working = value;
    while (working) {
      length += 1;
      working >>>= 1;
    }
    return length;
  }

  function formatBits(mask) {
    const value = (0b01 << 3) | mask; // Error correction level L.
    const generator = 0x537;
    let remainder = value << 10;
    while (bitLength(remainder) >= bitLength(generator)) {
      remainder ^= generator << (bitLength(remainder) - bitLength(generator));
    }
    return (((value << 10) | remainder) ^ 0x5412) & 0x7fff;
  }

  function placeFormat(matrix, mask) {
    const size = matrix.length;
    const bits = formatBits(mask);
    for (let index = 0; index < 15; index += 1) {
      const dark = ((bits >>> index) & 1) === 1;
      if (index < 6) matrix[index][8] = dark;
      else if (index < 8) matrix[index + 1][8] = dark;
      else matrix[size - 15 + index][8] = dark;

      if (index < 8) matrix[8][size - index - 1] = dark;
      else if (index === 8) matrix[8][7] = dark;
      else matrix[8][15 - index - 1] = dark;
    }
    matrix[size - 8][8] = true;
  }

  function masked(mask, row, column) {
    if (mask === 0) return (row + column) % 2 === 0;
    if (mask === 1) return row % 2 === 0;
    if (mask === 2) return column % 3 === 0;
    if (mask === 3) return (row + column) % 3 === 0;
    if (mask === 4) return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    if (mask === 5) return ((row * column) % 2) + ((row * column) % 3) === 0;
    if (mask === 6) return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
  }

  function placeData(matrix, codewords, mask) {
    const bits = [];
    codewords.forEach((value) => appendBits(bits, value, 8));
    const size = matrix.length;
    let row = size - 1;
    let direction = -1;
    let bitIndex = 0;
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right -= 1;
      while (true) {
        for (let offset = 0; offset < 2; offset += 1) {
          const column = right - offset;
          if (matrix[row][column] !== null) continue;
          let dark = bitIndex < bits.length && bits[bitIndex] === 1;
          if (masked(mask, row, column)) dark = !dark;
          matrix[row][column] = dark;
          bitIndex += 1;
        }
        row += direction;
        if (row >= 0 && row < size) continue;
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }

  function penalty(matrix) {
    const size = matrix.length;
    let score = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let outer = 0; outer < size; outer += 1) {
        let runColor = null;
        let runLength = 0;
        for (let inner = 0; inner < size; inner += 1) {
          const value = pass === 0 ? matrix[outer][inner] : matrix[inner][outer];
          if (value === runColor) runLength += 1;
          else {
            if (runLength >= 5) score += 3 + runLength - 5;
            runColor = value;
            runLength = 1;
          }
        }
        if (runLength >= 5) score += 3 + runLength - 5;
      }
    }
    for (let row = 0; row < size - 1; row += 1) {
      for (let column = 0; column < size - 1; column += 1) {
        const value = matrix[row][column];
        if (matrix[row + 1][column] === value && matrix[row][column + 1] === value && matrix[row + 1][column + 1] === value) score += 3;
      }
    }
    const dark = matrix.flat().filter(Boolean).length;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  function matrixFor(text) {
    const byteLength = new TextEncoder().encode(text).length;
    const version = versions.find((candidate) => byteLength <= candidate.capacity);
    if (!version) throw new Error('The viewer link is too long to create a QR code.');
    const data = dataCodewords(text, version);
    const codewords = data.concat(errorCorrection(data, version.eccCodewords));
    let best = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
      const candidate = baseMatrix(version);
      placeFormat(candidate, mask);
      placeData(candidate, codewords, mask);
      const candidateScore = penalty(candidate);
      if (candidateScore < bestScore) {
        best = candidate;
        bestScore = candidateScore;
      }
    }
    return best;
  }

  function draw(canvas, text) {
    const matrix = matrixFor(text);
    const quietZone = 4;
    const scale = 6;
    const pixels = (matrix.length + quietZone * 2) * scale;
    canvas.width = pixels;
    canvas.height = pixels;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, pixels, pixels);
    context.fillStyle = '#0d2e49';
    matrix.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) context.fillRect((x + quietZone) * scale, (y + quietZone) * scale, scale, scale);
    }));
  }

  window.SimpleQr = { draw, matrixFor };
})();
