// Friendly error display: the message plus the source line it is about,
// with ^^^ under the exact spot, like this:
//
//     4 |     total = total + i;
//   > 5 | print(totl);
//       |       ^^^^

// How many columns a character takes in a monospace font: combining marks
// (like the vowel signs in Tamil) take none, and Chinese/Japanese/Korean take two
export function displayWidth(text) {
    let width = 0;
    for (const char of text) {
        if (/\p{M}/u.test(char)) continue;
        width += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char) ? 2 : 1;
    }
    return width;
}

// Padding that lines up under 'prefix', keeping its tabs so the caret stays aligned
function padUnder(prefix) {
    let pad = '';
    for (const char of prefix) {
        if (char === '\t') pad += '\t';
        else pad += ' '.repeat(displayWidth(char));
    }
    return pad;
}

// 'where' is { line, column, length }. Without a column (runtime errors),
// the whole statement on that line is underlined.
export function codeFrame(source, where) {
    const lines = source.split('\n');
    const { line } = where;
    if (!line || line > lines.length) return [];

    const text = lines[line - 1];
    const gutterWidth = String(line).length;
    const gutter = (number) => String(number).padStart(gutterWidth);
    const frame = [];

    // One line before, for context, unless it is blank
    if (line > 1 && lines[line - 2].trim() !== '') {
        frame.push(`    ${gutter(line - 1)} | ${lines[line - 2]}`);
    }
    frame.push(`  > ${gutter(line)} | ${text}`);

    let start;
    let marked;
    if (where.column) {
        start = Math.min(where.column - 1, text.length);
        marked = text.slice(start, start + (where.length || 1)) || ' ';
    } else {
        start = text.length - text.trimStart().length;
        marked = text.trim() || ' ';
    }
    const caret = '^'.repeat(Math.max(1, displayWidth(marked)));
    frame.push(`    ${' '.repeat(gutterWidth)} | ${padUnder(text.slice(0, start))}${caret}`);
    return frame;
}

// Splits a source line into the text before the marked spot and the marked text itself,
// given the caret line's padding and number of carets. Used to draw the marker under the
// real text in the browser, where letters from some scripts are wider than one column.
export function splitAtCaret(text, padding, caretCount) {
    const chars = [...text];
    const target = displayWidth(padding.replace(/\t/g, ' '));
    let index = 0;
    let width = 0;
    const isMark = (char) => /\p{M}/u.test(char);
    while (index < chars.length && width < target) {
        width += displayWidth(chars[index] === '\t' ? ' ' : chars[index]);
        index++;
    }
    while (index < chars.length && isMark(chars[index])) index++; // keep marks with their letter
    let end = index;
    let marked = 0;
    while (end < chars.length && marked < caretCount) {
        marked += displayWidth(chars[end]);
        end++;
    }
    while (end < chars.length && isMark(chars[end])) end++;
    return { before: chars.slice(0, index).join(''), marked: chars.slice(index, end).join('') };
}

// The message followed by its code frame
export function describeProblem(source, problem) {
    return [problem.message, ...codeFrame(source, problem)].join('\n');
}
