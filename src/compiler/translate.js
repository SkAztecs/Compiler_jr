import { Lexer, keywordSpellings } from '../interpreter/lexer.js';
import { TokenType } from '../../token.js';

// Rewrites a program's keywords from one language to another, using the lexer:
// only keyword tokens change, so variable names, text and comments stay exactly as written.
// This is the lexer's job made visible: a keyword is just a spelling of a token type.
//
// Returns { code, conflicts }. 'conflicts' lists variable names that are keywords in the
// new language, since the program would no longer compile until they are renamed.
// Throws if the program cannot be read by the lexer.
export function translateKeywords(source, fromSettings, toSettings) {
    const tokens = new Lexer(source, fromSettings).getAllTokens();
    const newSpelling = new Map(keywordSpellings(toSettings).map(({ type, word }) => [type, word]));
    const newKeywords = new Set(newSpelling.values());

    let code = source;
    // Replace from the end so earlier offsets stay valid
    for (const token of [...tokens].reverse()) {
        if (!newSpelling.has(token.type) || token.start === undefined) continue;
        code = code.slice(0, token.start) + newSpelling.get(token.type) + code.slice(token.start + token.lexeme.length);
    }

    const conflicts = [...new Set(tokens
        .filter(token => token.type === TokenType.IDENTIFIER && newKeywords.has(token.value))
        .map(token => token.value))];
    return { code, conflicts };
}
