import React, { useState, useCallback } from 'react';

// --- 1. INTERPRETER LOGIC (Copied from original) ---
// This logic is pure JavaScript and doesn't need to be part of a React component.

// (Module 1) Using an object as a 'pseudo-enum'
const TokenType = {
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
    
    // Literals
    NUMBER: 'NUMBER',
    STRING: 'STRING',
    IDENTIFIER: 'IDENTIFIER',
    EOF: 'EOF'
};

class Token {
    constructor(type, value = null) {
        this.type = type;
        this.value = value;
    }
}

class Lexer {
    constructor(text, settings = {}) {
        this.text = text;
        this.pos = 0;
        this.currentChar = this.text[this.pos];
        
        // (Module 4) Hash Table (using JS Map) for keywords
        this.KEYWORDS = new Map([
            [settings.letKeyword || "let", new Token(TokenType.LET)],
            [settings.printKeyword || "print", new Token(TokenType.PRINT)],
            [settings.ifKeyword || "if", new Token(TokenType.IF)],
            [settings.elseKeyword || "else", new Token(TokenType.ELSE)],
            [settings.trueKeyword || "true", new Token(TokenType.TRUE)],
            [settings.falseKeyword || "false", new Token(TokenType.FALSE)],
            [settings.whileKeyword || "while", new Token(TokenType.WHILE)], 
            [settings.forKeyword || "for", new Token(TokenType.FOR)],       
        ]);
    }

    advance() {
        this.pos++;
        this.currentChar = this.pos < this.text.length ? this.text[this.pos] : null;
    }

    peek() {
        // Look ahead one character
        return this.pos + 1 < this.text.length ? this.text[this.pos + 1] : null;
    }

    isWhitespace(char) { return /\s/.test(char); }
    isDigit(char) { return /[0-9]/.test(char); }
    isAlpha(char) { return /[a-zA-Z_]/.test(char); } // Allow _
    isAlphaNumeric(char) { return /[a-zA-Z0-9_]/.test(char); }
    
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
        this.advance(); // Eat the opening "
        let result = "";
        while (this.currentChar !== null && this.currentChar !== '"') {
            result += this.currentChar;
            this.advance();
        }
        if (this.currentChar !== '"') {
            throw new Error("Unterminated string.");
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
        return this.KEYWORDS.get(result) || new Token(TokenType.IDENTIFIER, result);
    }

    getAllTokens() {
        // (Module 1/2) Using an Array as a Queue
        const tokenQueue = []; // push() to enqueue, shift() to dequeue
        
        while (this.currentChar !== null) {
            if (this.isWhitespace(this.currentChar)) {
                this.advance();
                continue;
            }
            if (this.isDigit(this.currentChar)) {
                tokenQueue.push(this.getNumber());
                continue;
            }
            if (this.isAlpha(this.currentChar)) {
                tokenQueue.push(this.getIdentifier());
                continue;
            }
            if (this.currentChar === '"') {
                tokenQueue.push(this.getString());
                continue;
            }

            // Multi-char tokens (==, !=, &&, ||)
            if (this.currentChar === '=' && this.peek() === '=') {
                this.advance(); this.advance();
                tokenQueue.push(new Token(TokenType.EQ));
                continue;
            }
            if (this.currentChar === '!' && this.peek() === '=') {
                this.advance(); this.advance();
                tokenQueue.push(new Token(TokenType.NOT_EQ));
                continue;
            }
            if (this.currentChar === '&' && this.peek() === '&') { 
                this.advance(); this.advance();
                tokenQueue.push(new Token(TokenType.AND));
                continue;
            }
            if (this.currentChar === '|' && this.peek() === '|') { 
                this.advance(); this.advance();
                tokenQueue.push(new Token(TokenType.OR));
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
                case '!': tokenType = TokenType.BANG; break; 
            }

            if (tokenType) {
                tokenQueue.push(new Token(tokenType));
                this.advance();
            } else {
                throw new Error(`Invalid character: ${this.currentChar}`);
            }
        }
        tokenQueue.push(new Token(TokenType.EOF));
        return tokenQueue;
    }
}

// --- 2. AST (Module 5: Trees) ---
class ASTNode {}
class ProgramNode extends ASTNode {
    constructor(statements) { super(); this.statements = statements; }
}
class LetStatementNode extends ASTNode {
    constructor(identifier, expression) { super(); this.identifier = identifier; this.expression = expression; }
}
class AssignmentNode extends ASTNode { // NEW
    constructor(identifier, expression) {
        super();
        this.identifier = identifier; // This is an IdentifierNode
        this.expression = expression;
    }
}
class PrintStatementNode extends ASTNode {
    constructor(expression) { super(); this.expression = expression; }
}
class BlockStatementNode extends ASTNode {
    constructor(statements) { super(); this.statements = statements; }
}
class IfStatementNode extends ASTNode {
    constructor(condition, consequence, alternative) {
        super();
        this.condition = condition;
        this.consequence = consequence;
        this.alternative = alternative;
    }
}
class WhileLoopNode extends ASTNode { 
    constructor(condition, body) {
        super();
        this.condition = condition;
        this.body = body; // A BlockStatementNode
    }
}
class ForLoopNode extends ASTNode { 
    constructor(initializer, condition, increment, body) {
        super();
        this.initializer = initializer;
        this.condition = condition;
        this.increment = increment;
        this.body = body; // A BlockStatementNode
    }
}
class IdentifierNode extends ASTNode {
    constructor(token) { super(); this.token = token; this.value = token.value; }
}
class NumberNode extends ASTNode {
    constructor(token) { super(); this.token = token; this.value = token.value; }
}
class StringNode extends ASTNode {
    constructor(token) { super(); this.token = token; this.value = token.value; }
}
class BooleanNode extends ASTNode {
    constructor(token) { super(); this.token = token; this.value = (token.type === TokenType.TRUE); }
}
class BinaryOpNode extends ASTNode {
    constructor(left, op, right) { super(); this.left = left; this.op = op; this.right = right; }
}
class UnaryOpNode extends ASTNode {
    constructor(op, right) { super(); this.op = op; this.right = right; }
}

// --- 3. PARSER (Recursive, Stack-based) ---
class Parser {
    constructor(tokenQueue) {
        this.tokens = tokenQueue; // Our queue
        this.currentToken = this.tokens.shift(); // Dequeue
    }

    advance() {
        this.currentToken = this.tokens.length > 0 ? this.tokens.shift() : new Token(TokenType.EOF);
    }
    
    eat(tokenType) {
        if (this.currentToken.type === tokenType) {
            this.advance();
        } else {
            throw new Error(`Expected ${tokenType}, but got ${this.currentToken.type}`);
        }
    }

    parseProgram() {
        const statements = [];
        while (this.currentToken.type !== TokenType.EOF) {
            statements.push(this.parseStatement());
        }
        return new ProgramNode(statements);
    }

    parseStatement() {
        switch (this.currentToken.type) {
            case TokenType.LET:
                return this.parseLetStatement();
            case TokenType.PRINT:
                return this.parsePrintStatement();
            case TokenType.IF:
                return this.parseIfStatement();
            case TokenType.WHILE: 
                return this.parseWhileLoop();
            case TokenType.FOR: 
                return this.parseForLoop();
            case TokenType.LBRACE:
                return this.parseBlockStatement();
            default:
                // Expression statement (now includes assignment)
                const node = this.parseExpression();
                if (this.currentToken.type === TokenType.SEMICOLON) {
                    this.advance();
                }
                return node;
        }
    }

    parseLetStatement() {
        this.advance(); // Eat 'LET'
        if (this.currentToken.type !== TokenType.IDENTIFIER) throw new Error("Expected identifier after 'let'");
        const identifier = new IdentifierNode(this.currentToken);
        this.advance(); // Eat identifier
        this.eat(TokenType.EQUALS); // Eat '='
        const expression = this.parseExpression();
        if (this.currentToken.type === TokenType.SEMICOLON) {
            this.advance();
        }
        return new LetStatementNode(identifier, expression);
    }

    parsePrintStatement() {
        this.advance(); // Eat 'PRINT'
        this.eat(TokenType.LPAREN);
        const expression = this.parseExpression();
        this.eat(TokenType.RPAREN);
        if (this.currentToken.type === TokenType.SEMICOLON) {
            this.advance();
        }
        return new PrintStatementNode(expression);
    }

    parseBlockStatement() {
        this.eat(TokenType.LBRACE);
        const statements = [];
        while (this.currentToken.type !== TokenType.RBRACE && this.currentToken.type !== TokenType.EOF) {
            statements.push(this.parseStatement());
        }
        this.eat(TokenType.RBRACE);
        return new BlockStatementNode(statements);
    }

    parseIfStatement() {
        this.advance(); // Eat 'IF'
        this.eat(TokenType.LPAREN);
        const condition = this.parseExpression();
        this.eat(TokenType.RPAREN);
        const consequence = this.parseBlockStatement();
        let alternative = null;
        if (this.currentToken.type === TokenType.ELSE) {
            this.advance(); // Eat 'ELSE'
            // MODIFICATION: Allow 'else if' chains
            if (this.currentToken.type === TokenType.IF) {
                alternative = this.parseIfStatement();
            } else {
                alternative = this.parseBlockStatement();
            }
        }
        return new IfStatementNode(condition, consequence, alternative);
    }

    parseWhileLoop() { 
        this.advance(); // Eat 'WHILE'
        this.eat(TokenType.LPAREN);
        const condition = this.parseExpression();
        this.eat(TokenType.RPAREN);
        const body = this.parseBlockStatement();
        return new WhileLoopNode(condition, body);
    }

    parseForLoop() { 
        this.advance(); // Eat 'FOR'
        this.eat(TokenType.LPAREN);

        // Initializer
        let initializer = null;
        if (this.currentToken.type === TokenType.LET) {
            initializer = this.parseLetStatement();
        } else if (this.currentToken.type !== TokenType.SEMICOLON) {
            initializer = this.parseExpression();
            this.eat(TokenType.SEMICOLON);
        } else {
            this.eat(TokenType.SEMICOLON);
        }

        // Condition
        let condition = null;
        if (this.currentToken.type !== TokenType.SEMICOLON) {
            condition = this.parseExpression();
        }
        this.eat(TokenType.SEMICOLON);

        // Increment
        let increment = null;
        if (this.currentToken.type !== TokenType.RPAREN) {
            increment = this.parseExpression();
        }
        this.eat(TokenType.RPAREN);

        // Body
        const body = this.parseBlockStatement();
        
        return new ForLoopNode(initializer, condition, increment, body);
    }

    // --- Precedence-Climbing Recursive Parser (Updated) ---
    // Order: Expression -> Assignment -> Logical OR -> Logical AND -> Comparison -> Term -> Factor -> Primary
    
    parseExpression() { // NEW: Top-level entry
        return this.parseAssignment();
    }

    parseAssignment() { // NEW: Handles i = 10
        const node = this.parseLogicalOr(); // Parse the left-hand side

        if (this.currentToken.type === TokenType.EQUALS) {
            this.advance(); // Eat =
            const value = this.parseAssignment(); // Recursively parse right side

            if (node instanceof IdentifierNode) {
                return new AssignmentNode(node, value);
            } else {
                throw new Error("Invalid assignment target.");
            }
        }

        return node; // Not an assignment
    }

    parseLogicalOr() { // Renamed from parseExpression
        let node = this.parseLogicalAnd();
        while (this.currentToken.type === TokenType.OR) {
            const opToken = this.currentToken;
            this.advance();
            const rightNode = this.parseLogicalAnd();
            node = new BinaryOpNode(node, opToken, rightNode);
        }
        return node;
    }

    parseLogicalAnd() { 
        let node = this.parseComparison();
        while (this.currentToken.type === TokenType.AND) {
            const opToken = this.currentToken;
            this.advance();
            const rightNode = this.parseComparison();
            node = new BinaryOpNode(node, opToken, rightNode);
        }
        return node;
    }

    parseComparison() {
        let node = this.parseTerm();
        while (this.currentToken.type === TokenType.EQ || this.currentToken.type === TokenType.NOT_EQ ||
               this.currentToken.type === TokenType.LT || this.currentToken.type === TokenType.GT) {
            const opToken = this.currentToken;
            this.advance();
            const rightNode = this.parseTerm();
            node = new BinaryOpNode(node, opToken, rightNode);
        }
        return node;
    }

    parseTerm() { // Handles + -
        let node = this.parseFactor();
        while (this.currentToken.type === TokenType.PLUS || this.currentToken.type === TokenType.MINUS) {
            const opToken = this.currentToken;
            this.advance();
            const rightNode = this.parseFactor();
            node = new BinaryOpNode(node, opToken, rightNode);
        }
        return node;
    }

    parseFactor() { // Handles * /
        let node = this.parsePrimary();
        while (this.currentToken.type === TokenType.MULTIPLY || this.currentToken.type === TokenType.DIVIDE) {
            const opToken = this.currentToken;
            this.advance();
            const rightNode = this.parsePrimary();
            node = new BinaryOpNode(node, opToken, rightNode);
        }
        return node;
    }

    parsePrimary() { // Handles atoms, (expr), unary ops
        const token = this.currentToken;
        
        if (token.type === TokenType.NUMBER) {
            this.advance();
            return new NumberNode(token);
        }
        if (token.type === TokenType.STRING) {
            this.advance();
            return new StringNode(token);
        }
        if (token.type === TokenType.TRUE || token.type === TokenType.FALSE) {
            this.advance();
            return new BooleanNode(token);
        }
        if (token.type === TokenType.IDENTIFIER) {
            this.advance();
            return new IdentifierNode(token);
        }
        if (token.type === TokenType.LPAREN) {
            this.advance(); // Eat '('
            const node = this.parseExpression(); // Recursive call to top
            this.eat(TokenType.RPAREN); // Eat ')'
            return node;
        }
        // Unary ops
        if (token.type === TokenType.PLUS || token.type === TokenType.MINUS || token.type === TokenType.BANG) {
            this.advance(); // Eat op
            const rightNode = this.parsePrimary(); // Note: recurses to self
            return new UnaryOpNode(token, rightNode);
        }
        throw new Error(`Unexpected token: ${token.type}`);
    }
}

// --- 4. EVALUATOR (Module 4/5: Hash Table & Tree Traversal) ---

class Environment {
    constructor(outer = null) {
        this.store = new Map();
        this.outer = outer; // (Module 1) Link to parent scope (stack-like)
    }
    
    // Defines a new variable in the *current* scope
    set(name, value) {
        this.store.set(name, value); // (Module 4) Hash Table Insert
        return value;
    }

    // (FIXED) Assigns to an *existing* variable in any scope
    assign(name, value) {
        if (this.store.has(name)) { // Check current scope
            this.store.set(name, value);
            return value;
        }
        if (this.outer !== null) { // (Module 1) Check up the stack
            return this.outer.assign(name, value);
        }
        throw new Error(`Cannot assign to undefined variable '${name}'.`);
    }

    get(name) {
        // (Module 4) Hash Table Lookup
        let value = this.store.get(name);
        if (value === undefined && this.outer !== null) {
            // (Module 1) If not in this scope, check the parent
            value = this.outer.get(name);
        }
        if (value === undefined) throw new Error(`Variable '${name}' not defined.`);
        return value;
    }
}

class Evaluator {
    constructor(outputLogger) {
        this.outputLogger = outputLogger;
    }

    evaluate(node, env) {
        // (Module 5) Tree Traversal (Visitor pattern)
        // This dispatch logic is the core of the visitor.
        if (node instanceof ProgramNode) {
            return this.evalProgram(node, env);
        } else if (node instanceof BlockStatementNode) {
            return this.evalBlockStatement(node, env);
        } else if (node instanceof LetStatementNode) {
            return this.evalLetStatement(node, env);
        } else if (node instanceof AssignmentNode) { // NEW
            return this.evalAssignmentNode(node, env);
        } else if (node instanceof PrintStatementNode) {
            return this.evalPrintStatement(node, env);
        } else if (node instanceof IfStatementNode) {
            return this.evalIfStatement(node, env);
        } else if (node instanceof WhileLoopNode) { 
            return this.evalWhileLoop(node, env);
        } else if (node instanceof ForLoopNode) { 
            return this.evalForLoop(node, env);
        
        // --- SHORT-CIRCUITING LOGIC ---
        } else if (node instanceof BinaryOpNode) {
            if (node.op.type === TokenType.AND) {
                const left = this.evaluate(node.left, env);
                if (!this.isTruthy(left)) return false; // Short-circuit
                return this.isTruthy(this.evaluate(node.right, env));
            }
            if (node.op.type === TokenType.OR) {
                const left = this.evaluate(node.left, env);
                if (this.isTruthy(left)) return true; // Short-circuit
                return this.isTruthy(this.evaluate(node.right, env));
            }
            // Not AND/OR, so pass to the standard arithmetic eval
            return this.evalBinaryOp(node, env);
        // --- END SHORT-CIRCUITING ---

        } else if (node instanceof UnaryOpNode) {
            return this.evalUnaryOp(node, env);
        } else if (node instanceof IdentifierNode) {
            return env.get(node.value); 
        } else if (node instanceof NumberNode) {
            return node.value; 
        } else if (node instanceof StringNode) {
            return node.value; 
        } else if (node instanceof BooleanNode) {
            return node.value; 
        } else {
            throw new Error(`No evaluation logic for node type: ${node.constructor.name}`);
        }
    }
    
    isTruthy(value) {
        if (value === null || value === false) {
            return false;
        }
        return true;
    }

    evalProgram(node, env) {
        let result = null;
        for (const statement of node.statements) {
            result = this.evaluate(statement, env);
        }
        return result;
    }

    evalBlockStatement(node, env) {
        const blockEnv = new Environment(env); // (Module 1) Create new stack frame
        let result = null;
        for (const statement of node.statements) {
            result = this.evaluate(statement, blockEnv);
        }
        return result;
    }

    evalLetStatement(node, env) {
        const value = this.evaluate(node.expression, env);
        return env.set(node.identifier.value, value); // Use 'set' for new variables
    }

    evalAssignmentNode(node, env) { // NEW
        const value = this.evaluate(node.expression, env);
        return env.assign(node.identifier.value, value); // Use 'assign' for existing
    }

    evalPrintStatement(node, env) {
        const value = this.evaluate(node.expression, env);
        this.outputLogger(value);
        return null;
    }

    evalIfStatement(node, env) {
        const condition = this.evaluate(node.condition, env);
        if (this.isTruthy(condition)) {
            return this.evaluate(node.consequence, env);
        } else if (node.alternative !== null) {
            return this.evaluate(node.alternative, env);
        } else {
            return null;
        }
    }

    evalWhileLoop(node, env) { 
        let result = null;
        while (this.isTruthy(this.evaluate(node.condition, env))) {
            result = this.evaluate(node.body, env);
        }
        return result; 
    }

    evalForLoop(node, env) { 
        const forEnv = new Environment(env); // (Module 1/4) New scope
        let result = null;

        if (node.initializer) {
            this.evaluate(node.initializer, forEnv);
        }
        
        while (true) {
            let conditionVal = true; 
            if (node.condition) {
                conditionVal = this.evaluate(node.condition, forEnv);
            }
            if (!this.isTruthy(conditionVal)) {
                break; 
            }

            result = this.evaluate(node.body, forEnv);

            if (node.increment) {
                this.evaluate(node.increment, forEnv);
            }
        }
        return result;
    }

    evalBinaryOp(node, env) {
        const leftVal = this.evaluate(node.left, env);
        const rightVal = this.evaluate(node.right, env);
        
        switch(node.op.type) {
            case TokenType.PLUS:
                if (typeof leftVal === 'string' || typeof rightVal === 'string') {
                    return String(leftVal) + String(rightVal);
                }
                return leftVal + rightVal;
            case TokenType.MINUS: return leftVal - rightVal;
            case TokenType.MULTIPLY: return leftVal * rightVal;
            case TokenType.DIVIDE: 
                if (rightVal === 0) throw new Error("Cannot divide by zero.");
                return leftVal / rightVal;
            
            case TokenType.EQ: return leftVal === rightVal;
            case TokenType.NOT_EQ: return leftVal !== rightVal;
            case TokenType.LT: return leftVal < rightVal;
            case TokenType.GT: return leftVal > rightVal;
                
            default: throw new Error(`Unknown binary operator: ${node.op.type}`);
        }
    }

    evalUnaryOp(node, env) {
        const rightVal = this.evaluate(node.right, env);
        switch(node.op.type) {
            case TokenType.MINUS: return -rightVal;
            case TokenType.PLUS: return +rightVal;
            case TokenType.BANG: return !this.isTruthy(rightVal); 
            default: throw new Error(`Unknown unary operator: ${node.op.type}`);
        }
    }
}

// --- 5. REACT UI COMPONENTS ---

// Default code for the editor
const DEFAULT_CODE_EXAMPLE = `print("--- While Loop Example ---");
let i = 0;
while (i < 3) {
    print(i);
    i = i + 1;
}

print("--- For Loop Example ---");
for (let j = 0; j < 3; j = j + 1) {
    print(j);
}

print("--- Logic Example ---");
let a = true;
let b = false;
if (a && !b) {
    print("Logic works!");
} else {
    print("Something is wrong");
}

print("--- Short-Circuit OR ---");
print(true || (1 / 0)); // Does not error`;

/**
 * Injects the global styles from the original <style> tag.
 */
const GlobalStyles = () => (
  <style>
    {`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500;600&display=swap');
      
      body {
        font-family: 'Inter', sans-serif;
      }
      
      textarea, pre {
        font-family: 'Fira Code', monospace;
        font-size: 0.9rem;
        line-height: 1.6;
      }
      
      textarea::-webkit-scrollbar {
        width: 8px;
      }
      textarea::-webkit-scrollbar-track {
        background: #1f2937; /* bg-gray-800 */
      }
      textarea::-webkit-scrollbar-thumb {
        background: #4b5563; /* bg-gray-600 */
        border-radius: 4px;
      }
    `}
  </style>
);

/**
 * The header component with buttons.
 */
const Header = ({ onHelpClick, onSettingsClick, onRunClick }) => (
    <nav className="bg-gray-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
                <div className="flex-shrink-0">
                    <h1 className="text-2xl font-bold text-white">My Language Interpreter</h1>
                </div>
                <div className="flex-shrink-0 flex items-center gap-4">
                    <button 
                        onClick={onHelpClick}
                        className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-200 ease-in-out"
                    >
                        Syntax & Help
                    </button>
                    <button 
                        onClick={onSettingsClick}
                        className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-200 ease-in-out"
                    >
                        Settings
                    </button>
                    <button 
                        onClick={onRunClick}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-200 ease-in-out"
                    >
                        Run Code
                    </button>
                </div>
            </div>
        </div>
    </nav>
);

/**
 * The main content area with editor and console.
 */
const MainContent = ({ code, setCode, output }) => (
    <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:px-8 mt-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Code Editor Column */}
            <div>
                <label htmlFor="code-input" className="block text-sm font-medium text-gray-300 mb-2">Code Editor</label>
                <textarea 
                    id="code-input" 
                    className="w-full h-96 p-4 bg-gray-800 text-gray-100 rounded-lg shadow-inner border border-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    spellCheck="false"
                />
                <p className="text-xs text-gray-500 mt-2">Type your code above and press "Run Code".</p>
            </div>

            {/* Output Console Column */}
            <div>
                <label htmlFor="output-console" className="block text-sm font-medium text-gray-300 mb-2">Console</label>
                <pre 
                    id="output-console" 
                    className={`w-full h-96 p-4 bg-gray-800 rounded-lg shadow-inner border border-gray-700 overflow-auto whitespace-pre-wrap ${
                        output.startsWith('--- ERROR ---') ? 'text-red-400' : 'text-gray-100'
                    }`}
                >
                    {output}
                </pre>
                <p className="text-xs text-gray-500 mt-2">Shows 'print' output and the final variable state.</p>
            </div>
        </div>
    </main>
);

/**
 * The Help & Syntax Modal.
 */
const HelpModal = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
            onClick={onClose} // Close on backdrop click
        >
            <div 
                className="bg-gray-800 w-full max-w-2xl rounded-lg shadow-2xl overflow-hidden" 
                style={{ maxHeight: '80vh' }}
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                {/* Modal Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-700">
                    <h2 className="text-xl font-semibold text-white">Syntax & Help Guide</h2>
                    <button 
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl font-bold"
                    >
                        &times;
                    </button>
                </div>
                
                {/* Modal Content */}
                <div className="p-6 text-gray-300 overflow-y-auto" style={{ maxHeight: 'calc(80vh - 73px)' }}>
                    <h3 className="text-lg font-semibold text-blue-400 mb-2">Welcome!</h3>
                    <p className="mb-4">
                        This is a simple interpreter for a custom language. It reads your code, calculates the results, and stores variables.
                        The console on the right shows the output from <b>print</b> statements and the final state of all your variables.
                    </p>

                    <h3 className="text-lg font-semibold text-blue-400 mb-2">1. Variables (Definition vs. Assignment)</h3>
                    <p className="mb-2">
                        Use <code>let</code> to <b>define</b> a new variable. This creates the variable in the current scope.
                    </p>
                    <pre className="bg-gray-900 p-3 rounded-md text-sm">let x = 10;</pre>
                    <p className="mt-2 mb-2">
                        Use <code>=</code> on an *existing* variable to <b>assign</b> a new value to it.
                    </p>
                    <pre className="bg-gray-900 p-3 rounded-md text-sm">let x = 10;<br/>x = x + 5; // x is now 15</pre>
                    <p className="text-sm text-blue-300 mt-2 mb-2"><b>Note:</b> You can change the 'let' keyword in the <b>Settings</b> panel!</p>
                    
                    <h3 className="text-lg font-semibold text-blue-400 mt-4 mb-2">2. Data Types</h3>
                    <p className="mb-2">We now support three data types:</p>
                    <ul className="list-disc list-inside mb-2">
                        <li><strong>Numbers:</strong> All numbers (e.g., <code>10</code>, <code>5.5</code>, <code>-3</code>).</li>
                        <li><strong>Booleans:</strong> <code>true</code> or <code>false</code>.</li>
                        <li><strong>Strings:</strong> Text surrounded by double quotes (e.g., <code>"Hello"</code>).</li>
                    </ul>

                    <h3 className="text-lg font-semibold text-blue-400 mt-4 mb-2">3. Printing to Console</h3>
                    <p className="mb-2">Use the <code>print</code> statement to output a value to the console.</p>
                    <pre className="bg-gray-900 p-3 rounded-md text-sm">print(10 + 5);  // Outputs: 15<br/>print("Hello World!"); // Outputs: Hello World!</pre>

                    <h3 className="text-lg font-semibold text-blue-400 mt-4 mb-2">4. Operators</h3>
                    <p className="mb-2">Standard arithmetic and logical operators are supported.</p>
                    <p className="mt-2 mb-2">Operators:</p>
                    <ul className="list-disc list-inside mb-2">
                        <li>Assignment: <code>=</code></li>
                        <li>Arithmetic: <code>+</code> (Addition / String Concatenation), <code>-</code>, <code>*</code>, <code>/</code></li>
                        <li>Unary: <code>-</code> (negative), <code>!</code> (logical NOT)</li>
                        <li>Comparison: <code>==</code> (equal), <code>!=</code> (not equal), <code>&lt;</code> (less than), <code>&gt;</code> (greater than)</li>
                        <li>Logical: <code>&&</code> (AND), <code>||</code> (OR). These are short-circuiting.</li>
                    </ul>
                    <pre className="bg-gray-900 p-3 rounded-md text-sm">print(10 &gt; 5 && "a" == "a"); // Outputs: true<br/>print(10 &lt; 5 || true);     // Outputs: true<br/>print(!false);             // Outputs: true</pre>

                    <h3 className="text-lg font-semibold text-blue-400 mt-4 mb-2">5. Control Flow (if/else)</h3>
                    <p className="mb-2">
                        Use <code>if</code> and <code>else</code> to control which code executes. Code blocks <b>must</b> be surrounded by <code>{ }</code> braces.
                    </p>
                    <pre className="bg-gray-900 p-3 rounded-md text-sm">
{`let x = 10;
if (x > 5 && x < 20) {
    print("x is between 5 and 20");
} else {
    print("x is not in range");
}`}
                    </pre>
                    <h3 className="text-lg font-semibold text-blue-400 mt-4 mb-2">6. Loops (while / for)</h3>
                    <p className="mb-2">
                        <b>while loops</b> repeat as long as a condition is true.
                    </p>
                    <pre className="bg-gray-900 p-3 rounded-md text-sm">
{`let i = 0;
while (i < 3) {
    print(i);
    i = i + 1; // Assignment
}
// Outputs: 0, 1, 2`}
                    </pre>
                    <p className="mt-4 mb-2">
                        <b>for loops</b> are C-style loops with an initializer, condition, and increment.
                    </p>
                    <pre className="bg-gray-900 p-3 rounded-md text-sm">
{`for (let j = 0; j < 3; j = j + 1) {
    print(j);
}
// Outputs: 0, 1, 2`}
                    </pre>
                </div>
            </div>
        </div>
    );
};

/**
 * The Settings Modal
 */
const SettingsModal = ({ isOpen, onClose, settings, onSettingsChange }) => {
    if (!isOpen) return null;

    // Helper to create input fields
    const SettingInput = ({ id, label, valueKey }) => (
        <div className="mb-4">
            <label htmlFor={id} className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
            <input 
                type="text" 
                id={id} 
                value={settings[valueKey]}
                onChange={(e) => onSettingsChange(valueKey, e.target.value)}
                className="w-full bg-gray-900 text-white border border-gray-700 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
        </div>
    );

    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
            onClick={onClose} // Close on backdrop click
        >
            <div 
                className="bg-gray-800 w-full max-w-lg rounded-lg shadow-2xl overflow-hidden" 
                style={{ maxHeight: '80vh' }}
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                {/* Modal Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-700">
                    <h2 className="text-xl font-semibold text-white">Language Settings</h2>
                    <button 
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl font-bold"
                    >
                        &times;
                    </button>
                </div>
                
                {/* Modal Content */}
                <div className="p-6 text-gray-300 overflow-y-auto" style={{ maxHeight: 'calc(80vh - 73px)' }}>
                    <p className="mb-4">Configure the keywords for your language. This will change how the Lexer tokenizes your code.</p>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <SettingInput id="setting-let-keyword" label="Variable Keyword" valueKey="letKeyword" />
                        <SettingInput id="setting-print-keyword" label="Print Keyword" valueKey="printKeyword" />
                        <SettingInput id="setting-if-keyword" label="If Keyword" valueKey="ifKeyword" />
                        <SettingInput id="setting-else-keyword" label="Else Keyword" valueKey="elseKeyword" />
                        <SettingInput id="setting-true-keyword" label="True Keyword" valueKey="trueKeyword" />
                        <SettingInput id="setting-false-keyword" label="False Keyword" valueKey="falseKeyword" />
                        <SettingInput id="setting-while-keyword" label="While Keyword" valueKey="whileKeyword" />
                        <SettingInput id="setting-for-keyword" label="For Keyword" valueKey="forKeyword" />
                    </div>
                </div>
            </div>
        </div>
    );
};


/**
 * The main App component that holds all state.
 */
function App() {
    // --- React State ---
    const [code, setCode] = useState(DEFAULT_CODE_EXAMPLE);
    const [output, setOutput] = useState("Click 'Run Code' to see the output...");
    const [settings, setSettings] = useState({
        letKeyword: "let",
        printKeyword: "print",
        ifKeyword: "if",
        elseKeyword: "else",
        trueKeyword: "true",
        falseKeyword: "false",
        whileKeyword: "while",
        forKeyword: "for",
    });
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

    /**
     * The main function to run the interpreter.
     * Wrapped in useCallback to optimize performance.
     */
    const runCode = useCallback(() => {
        let printedOutput = [];
        
        // This logger function will be passed to the Evaluator
        const outputLogger = (value) => {
            if (value === null) {
                printedOutput.push('null');
            } else if (value === true) {
                printedOutput.push('true');
            } else if (value === false) {
                printedOutput.push('false');
            } else {
                printedOutput.push(value.toString());
            }
        };
        
        try {
            // 1. Lexer
            // Pass the current 'settings' state to the Lexer
            const lexer = new Lexer(code, settings);
            const tokens = lexer.getAllTokens();
            
            // 2. Parser
            const parser = new Parser(tokens);
            const ast = parser.parseProgram();
            
            // 3. Evaluator
            const globalEnv = new Environment();
            const evaluator = new Evaluator(outputLogger); // Pass the logger
            
            // 4. Run!
            evaluator.evaluate(ast, globalEnv);
            
            // 5. Display Output
            let newOutput = "";
            if (printedOutput.length > 0) {
                newOutput += "--- Printed Output ---\n";
                newOutput += printedOutput.join('\n');
                newOutput += "\n\n";
            } else {
                newOutput += "--- No Printed Output ---\n\n";
            }

            newOutput += "--- Final Environment (Global) ---\n";
            const envObject = Object.fromEntries(globalEnv.store);
            newOutput += JSON.stringify(envObject, null, 2);
            
            setOutput(newOutput); // Set the final string
            
        } catch (e) {
            // Handle errors gracefully
            setOutput(`--- ERROR ---\n${e.message}\n(Check console for stack trace)`);
            console.error(e); // Log the full error for debugging
        }
    }, [code, settings]); // Dependencies: re-run if code or settings change

    /**
     * Handler for updating settings from the modal.
     */
    const handleSettingsChange = (settingKey, value) => {
        setSettings(prev => ({
            ...prev,
            [settingKey]: value
        }));
    };

    // --- Render the App ---
    return (
        <div className="bg-gray-900 text-gray-200 min-h-screen">
            <GlobalStyles />
            <Header 
                onHelpClick={() => setIsHelpModalOpen(true)}
                onSettingsClick={() => setIsSettingsModalOpen(true)}
                onRunClick={runCode}
            />
            <MainContent 
                code={code}
                setCode={setCode}
                output={output}
            />
            <HelpModal 
                isOpen={isHelpModalOpen}
                onClose={() => setIsHelpModalOpen(false)}
            />
            <SettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
                settings={settings}
                onSettingsChange={handleSettingsChange}
            />
        </div>
    );
}

export default App;
