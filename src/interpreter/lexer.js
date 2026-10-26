import { Token, TokenType } from '../../token.js';

// Settings key, default spelling and token type for each keyword
const KEYWORD_SETTINGS = [
    ["letKeyword", "let", TokenType.LET],
    ["printKeyword", "print", TokenType.PRINT],
    ["ifKeyword", "if", TokenType.IF],
    ["elseKeyword", "else", TokenType.ELSE],
    ["trueKeyword", "true", TokenType.TRUE],
    ["falseKeyword", "false", TokenType.FALSE],
    ["whileKeyword", "while", TokenType.WHILE],
    ["forKeyword", "for", TokenType.FOR],
    ["funcKeyword", "func", TokenType.FUNC],
    ["returnKeyword", "return", TokenType.RETURN],
];

// Each keyword's English default and how it is spelled with these settings
export function keywordSpellings(settings = {}) {
    return KEYWORD_SETTINGS.map(([settingKey, defaultWord, type]) => ({
        settingKey,
        defaultWord,
        type,
        word: (settings[settingKey] || "").trim() || defaultWord,
    }));
}

// Hints for characters beginners often try to use
const CHARACTER_HINTS = {
    "'": 'Text goes inside double quotes, like "hello".',
    '%': "There is no '%' (remainder) operator yet.",
    '[': 'Lists are not supported yet.',
    ']': 'Lists are not supported yet.',
};

export class Lexer {
    constructor(text, settings = {}) {
        this.text = text;
        this.pos = 0;
        this.currentChar = this.text.length > 0 ? this.text[0] : null;
        this.line = 1;
        this.column = 1;

        // (Module 4) Hash Table (using JS Map) for keywords
        this.KEYWORDS = new Map();
        for (const { word, type: tokenType } of keywordSpellings(settings)) {
            // A keyword must be a word getIdentifier() can read, or it could never match
            if (!/^[\p{L}\p{M}_][\p{L}\p{N}\p{M}_]*$/u.test(word)) {
                throw new Error(`Keyword "${word}" (for ${tokenType}) must be one word of letters, digits or _, not starting with a digit.`);
            }
            // Two keywords with the same spelling would silently overwrite each other
            if (this.KEYWORDS.has(word)) {
                throw new Error(`Keyword "${word}" is used for both ${this.KEYWORDS.get(word)} and ${tokenType}. Each keyword must be unique.`);
            }
            this.KEYWORDS.set(word, tokenType);
        }
    }

    advance() {
        if (this.currentChar === '\n') {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
        this.pos++;
        this.currentChar = this.pos < this.text.length ? this.text[this.pos] : null;
    }

    peek() {
        // Look ahead one character
        return this.pos + 1 < this.text.length ? this.text[this.pos + 1] : null;
    }

    // An error that remembers where it happened, so the editor can point at it
    error(message, line, column, length = 1) {
        const error = new Error(message);
        error.line = line;
        error.column = column;
        error.length = length;
        return error;
    }

    isWhitespace(char) { return /\s/.test(char); }
    isDigit(char) { return /[0-9]/.test(char); }
    isAlpha(char) { 
        // Support Unicode letters from any language (scripts like Arabic, Chinese, Japanese, Tamil, etc.)
        // Also include combining marks (like Tamil virama ்) which are part of identifiers
        return /[\p{L}\p{M}_]/u.test(char); 
    }
    isAlphaNumeric(char) { 
        // Support Unicode letters, numbers, and combining marks (for scripts like Tamil)
        return /[\p{L}\p{N}\p{M}_]/u.test(char); 
    }
    
    getNumber() {
        let result = "";
        while (this.currentChar !== null && this.isDigit(this.currentChar)) {
            result += this.currentChar;
            this.advance();
        }
        if (this.currentChar === '.') {
            result += '.';
            this.advance();
            while (this.currentChar !== null && this.isDigit(this.currentChar)) {
                result += this.currentChar;
                this.advance();
            }
        }
        return new Token(TokenType.NUMBER, parseFloat(result));
    }

    getString() {
        const startLine = this.line;
        const startColumn = this.column;
        this.advance(); // Eat the opening "
        let result = "";
        while (this.currentChar !== null && this.currentChar !== '"') {
            result += this.currentChar;
            this.advance();
        }
        if (this.currentChar !== '"') {
            throw this.error(`Line ${startLine}: This text never ends. Add a closing " to finish it.`, startLine, startColumn);
        }
        this.advance(); // Eat the closing "
        return new Token(TokenType.STRING, result);
    }

    getIdentifier() {
        let result = "";
        while (this.currentChar !== null && this.isAlphaNumeric(this.currentChar)) {
            result += this.currentChar;
            this.advance();
        }
        const keywordType = this.KEYWORDS.get(result);
        return keywordType ? new Token(keywordType) : new Token(TokenType.IDENTIFIER, result);
    }

    getAllTokens() {
        // (Module 1/2) Using an Array as a Queue
        const tokenQueue = []; // push() to enqueue, shift() to dequeue
        
        while (this.currentChar !== null) {
            // Every token remembers where it started, for error messages and later phases
            const line = this.line;
            const column = this.column;
            const start = this.pos;
            const push = (token) => {
                token.line = line;
                token.column = column;
                token.lexeme = this.text.slice(start, this.pos); // the exact text, e.g. a regional keyword
                token.start = start;                             // offset in the source, for rewriting keywords
                tokenQueue.push(token);
            };

            if (this.isWhitespace(this.currentChar)) {
                this.advance();
                continue;
            }
            if (this.isDigit(this.currentChar)) {
                push(this.getNumber());
                continue;
            }
            if (this.isAlpha(this.currentChar)) {
                push(this.getIdentifier());
                continue;
            }
            if (this.currentChar === '"') {
                push(this.getString());
                continue;
            }

            // Comments: skip from // to the end of the line
            if (this.currentChar === '/' && this.peek() === '/') {
                while (this.currentChar !== null && this.currentChar !== '\n') {
                    this.advance();
                }
                continue;
            }

            // Multi-char tokens (==, !=, &&, ||)
            if (this.currentChar === '=' && this.peek() === '=') {
                this.advance(); this.advance();
                push(new Token(TokenType.EQ));
                continue;
            }
            if (this.currentChar === '!' && this.peek() === '=') {
                this.advance(); this.advance();
                push(new Token(TokenType.NOT_EQ));
                continue;
            }
            if (this.currentChar === '&' && this.peek() === '&') { 
                this.advance(); this.advance();
                push(new Token(TokenType.AND));
                continue;
            }
            if (this.currentChar === '|' && this.peek() === '|') { 
                this.advance(); this.advance();
                push(new Token(TokenType.OR));
                continue;
            }

            // Single-char tokens
            let tokenType = null;
            switch(this.currentChar) {
                case '+': tokenType = TokenType.PLUS; break;
                case '-': tokenType = TokenType.MINUS; break;
                case '*': tokenType = TokenType.MULTIPLY; break;
                case '/': tokenType = TokenType.DIVIDE; break;
                case '(': tokenType = TokenType.LPAREN; break;
                case ')': tokenType = TokenType.RPAREN; break;
                case '{': tokenType = TokenType.LBRACE; break;
                case '}': tokenType = TokenType.RBRACE; break;
                case '=': tokenType = TokenType.EQUALS; break;
                case '<': tokenType = TokenType.LT; break;
                case '>': tokenType = TokenType.GT; break;
                case ';': tokenType = TokenType.SEMICOLON; break;
                case ',': tokenType = TokenType.COMMA; break;
                case '!': tokenType = TokenType.BANG; break; 
            }

            if (tokenType) {
                this.advance();
                push(new Token(tokenType));
            } else {
                const hint = CHARACTER_HINTS[this.currentChar];
                throw this.error(`Line ${line}: The character '${this.currentChar}' is not part of this language.${hint ? ` ${hint}` : ''}`, line, column);
            }
        }
        const eof = new Token(TokenType.EOF, null, this.line, this.column);
        eof.lexeme = '';
        tokenQueue.push(eof);
        return tokenQueue;
    }
}