// (Module 1) Using an object as a 'pseudo-enum'
export const TokenType = {
    PLUS: 'PLUS',
    MINUS: 'MINUS',
    MULTIPLY: 'MULTIPLY',
    DIVIDE: 'DIVIDE',
    LPAREN: 'LPAREN',
    RPAREN: 'RPAREN',
    LBRACE: 'LBRACE', // {
    RBRACE: 'RBRACE', // }
    EQUALS: 'EQUALS', // =
    EQ: 'EQ',         // ==
    NOT_EQ: 'NOT_EQ', // !=
    LT: 'LT',         // <
    GT: 'GT',         // >
    SEMICOLON: 'SEMICOLON',
    COMMA: 'COMMA',   // ,  (between arguments)
    
    BANG: 'BANG',     // !   
    AND: 'AND',       // &&  
    OR: 'OR',         // ||  
    
    // Keywords
    LET: 'LET',
    PRINT: 'PRINT',
    IF: 'IF',
    ELSE: 'ELSE',
    TRUE: 'TRUE',
    FALSE: 'FALSE',
    WHILE: 'WHILE',   
    FOR: 'FOR',       
    FUNC: 'FUNC',
    RETURN: 'RETURN',
    
    // Literals
    NUMBER: 'NUMBER',
    STRING: 'STRING',
    IDENTIFIER: 'IDENTIFIER',
    EOF: 'EOF'
};

export class Token {
    constructor(type, value = null, line = null, column = null) {
        this.type = type;
        this.value = value;
        this.line = line;     // 1-based source line, set by the Lexer
        this.column = column; // 1-based source column
    }
}