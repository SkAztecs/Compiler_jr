import { Token, TokenType } from '../../token.js';
import {
    ProgramNode,
    LetStatementNode,
    AssignmentNode,
    PrintStatementNode,
    BlockStatementNode,
    IfStatementNode,
    WhileLoopNode,
    ForLoopNode,
    IdentifierNode,
    NumberNode,
    StringNode,
    BooleanNode,
    BinaryOpNode,
    UnaryOpNode,
    FunctionDeclarationNode,
    ReturnStatementNode,
    CallNode
} from '../../ast.js';

// How expected tokens are named in error messages
const SYMBOLS = {
    [TokenType.LPAREN]: "'('",
    [TokenType.RPAREN]: "')'",
    [TokenType.LBRACE]: "'{'",
    [TokenType.RBRACE]: "'}'",
    [TokenType.EQUALS]: "'='",
    [TokenType.SEMICOLON]: "';'",
};

// A beginner-friendly hint for each missing symbol
const EAT_HINTS = {
    [TokenType.RPAREN]: "Every '(' needs a matching ')'.",
    [TokenType.LPAREN]: "The condition or value goes inside ( ).",
    [TokenType.LBRACE]: "The code to repeat or choose goes inside { }.",
    [TokenType.SEMICOLON]: "The three parts inside a for loop's ( ) are separated by ';'.",
};

// Explanations for tokens that often turn up in the wrong place
const UNEXPECTED_HINTS = {
    [TokenType.RBRACE]: () => "This '}' has no matching '{' before it.",
    [TokenType.RPAREN]: () => "This ')' has no matching '(' before it.",
    [TokenType.ELSE]: (token) => `'${token.lexeme}' must come straight after the closing '}' of an if block.`,
    [TokenType.EOF]: () => 'The program ended in the middle of a statement. Is something missing at the end?',
    [TokenType.COMMA]: () => "A ',' only goes between a function's arguments or parameters. To separate the parts of a for loop, use ';'.",
};

export class Parser {
    constructor(tokenQueue) {
        this.tokens = tokenQueue; // Our queue
        this.currentToken = this.tokens.shift(); // Dequeue
    }

    advance() {
        this.previousToken = this.currentToken; // remembered for error hints
        this.currentToken = this.tokens.length > 0 ? this.tokens.shift() : new Token(TokenType.EOF);
    }

    // Records which source line a node came from, so later phases can point back at it
    at(node, token) {
        node.line = token.line;
        node.column = token.column;
        return node;
    }

    // An error that remembers where it happened (by default, at the current token)
    error(message, token = this.currentToken) {
        const line = token.line;
        const error = new Error(line ? `Line ${line}: ${message}` : message);
        error.line = line; // lets the editor highlight the line
        error.column = token.column;
        error.length = Math.max(1, (token.lexeme ?? '').length);
        return error;
    }

    // How a token is shown in messages: as the student wrote it, keywords included
    describe(token) {
        return token.type === TokenType.EOF ? 'the end of the program' : `'${token.lexeme}'`;
    }

    eat(tokenType, hint = EAT_HINTS[tokenType] ?? '') {
        if (this.currentToken.type === tokenType) {
            this.advance();
        } else {
            const expected = SYMBOLS[tokenType] ?? tokenType;
            throw this.error(`Expected ${expected} here, but found ${this.describe(this.currentToken)}.${hint ? ` ${hint}` : ''}`);
        }
    }

    parseProgram() {
        const start = this.currentToken;
        const statements = [];
        while (this.currentToken.type !== TokenType.EOF) {
            statements.push(this.parseStatement());
        }
        return this.at(new ProgramNode(statements), start);
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
            case TokenType.FUNC:
                return this.parseFunctionDeclaration();
            case TokenType.RETURN:
                return this.parseReturnStatement();
            default: {
                // Expression statement (now includes assignment)
                const node = this.parseExpression();
                if (this.currentToken.type === TokenType.SEMICOLON) {
                    this.advance();
                }
                return node;
            }
        }
    }

    // func name(a, b) { ... }
    parseFunctionDeclaration() {
        const start = this.currentToken;
        this.advance(); // Eat 'FUNC'
        if (this.currentToken.type !== TokenType.IDENTIFIER) {
            throw this.error(`Expected the function's name after '${start.lexeme}', but found ${this.describe(this.currentToken)}. For example: ${start.lexeme} add(a, b) { ... }`);
        }
        const name = this.at(new IdentifierNode(this.currentToken), this.currentToken);
        this.advance();
        this.eat(TokenType.LPAREN, "The function's parameters go inside ( ), even when there are none: ()");
        const params = [];
        if (this.currentToken.type !== TokenType.RPAREN) {
            do {
                if (params.length > 0) this.advance(); // Eat ','
                if (this.currentToken.type !== TokenType.IDENTIFIER) {
                    throw this.error(`Expected a parameter name, but found ${this.describe(this.currentToken)}. Parameters are names separated by commas.`);
                }
                params.push(this.at(new IdentifierNode(this.currentToken), this.currentToken));
                this.advance();
            } while (this.currentToken.type === TokenType.COMMA);
        }
        this.eat(TokenType.RPAREN, "Parameters are names separated by commas, and the list ends with ')'.");
        const body = this.parseBlockStatement();
        return this.at(new FunctionDeclarationNode(name, params, body), start);
    }

    // return value;   or   return;
    parseReturnStatement() {
        const start = this.currentToken;
        this.advance(); // Eat 'RETURN'
        let expression = null;
        if (this.currentToken.type !== TokenType.SEMICOLON && this.currentToken.type !== TokenType.RBRACE) {
            expression = this.parseExpression();
        }
        if (this.currentToken.type === TokenType.SEMICOLON) {
            this.advance();
        }
        return this.at(new ReturnStatementNode(expression), start);
    }

    parseLetStatement() {
        const start = this.currentToken;
        this.advance(); // Eat 'LET'
        if (this.currentToken.type !== TokenType.IDENTIFIER) {
            throw this.error(`Expected a variable name after '${start.lexeme}', but found ${this.describe(this.currentToken)}. For example: ${start.lexeme} count = 0;`);
        }
        const identifier = this.at(new IdentifierNode(this.currentToken), this.currentToken);
        this.advance(); // Eat identifier
        this.eat(TokenType.EQUALS, `A new variable needs a starting value, like: ${start.lexeme} ${identifier.value} = 0;`); // Eat '='
        const expression = this.parseExpression();
        if (this.currentToken.type === TokenType.SEMICOLON) {
            this.advance();
        }
        return this.at(new LetStatementNode(identifier, expression), start);
    }

    parsePrintStatement() {
        const start = this.currentToken;
        this.advance(); // Eat 'PRINT'
        this.eat(TokenType.LPAREN);
        const expression = this.parseExpression();
        this.eat(TokenType.RPAREN);
        if (this.currentToken.type === TokenType.SEMICOLON) {
            this.advance();
        }
        return this.at(new PrintStatementNode(expression), start);
    }

    parseBlockStatement() {
        const start = this.currentToken;
        this.eat(TokenType.LBRACE);
        const statements = [];
        while (this.currentToken.type !== TokenType.RBRACE && this.currentToken.type !== TokenType.EOF) {
            statements.push(this.parseStatement());
        }
        if (this.currentToken.type === TokenType.EOF) {
            // Point at the '{' that was left open, not at the end of the file
            throw this.error(`The '{' on line ${start.line} is never closed. Add a '}' where this block should end.`, start);
        }
        this.eat(TokenType.RBRACE);
        return this.at(new BlockStatementNode(statements), start);
    }

    parseIfStatement() {
        const start = this.currentToken;
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
        return this.at(new IfStatementNode(condition, consequence, alternative), start);
    }

    parseWhileLoop() { 
        const start = this.currentToken;
        this.advance(); // Eat 'WHILE'
        this.eat(TokenType.LPAREN);
        const condition = this.parseExpression();
        this.eat(TokenType.RPAREN);
        const body = this.parseBlockStatement();
        return this.at(new WhileLoopNode(condition, body), start);
    }

    parseForLoop() { 
        const start = this.currentToken;
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
        
        return this.at(new ForLoopNode(initializer, condition, increment, body), start);
    }

    // --- Precedence-Climbing Recursive Parser (Updated) ---
    // Order: Expression -> Assignment -> Logical OR -> Logical AND -> Comparison -> Term -> Factor -> Primary
    
    parseExpression() { // NEW: Top-level entry
        return this.parseAssignment();
    }

    parseAssignment() { // NEW: Handles i = 10
        const node = this.parseLogicalOr(); // Parse the left-hand side

        if (this.currentToken.type === TokenType.EQUALS) {
            const opToken = this.currentToken;
            this.advance(); // Eat =
            const value = this.parseAssignment(); // Recursively parse right side

            if (node instanceof IdentifierNode) {
                return this.at(new AssignmentNode(node, value), node);
            } else {
                throw this.error("Only a variable name can go on the left of '='. To compare two values, use '=='.", opToken);
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
            node = this.at(new BinaryOpNode(node, opToken, rightNode), opToken);
        }
        return node;
    }

    parseLogicalAnd() { 
        let node = this.parseComparison();
        while (this.currentToken.type === TokenType.AND) {
            const opToken = this.currentToken;
            this.advance();
            const rightNode = this.parseComparison();
            node = this.at(new BinaryOpNode(node, opToken, rightNode), opToken);
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
            node = this.at(new BinaryOpNode(node, opToken, rightNode), opToken);
        }
        return node;
    }

    parseTerm() { // Handles + -
        let node = this.parseFactor();
        while (this.currentToken.type === TokenType.PLUS || this.currentToken.type === TokenType.MINUS) {
            const opToken = this.currentToken;
            this.advance();
            const rightNode = this.parseFactor();
            node = this.at(new BinaryOpNode(node, opToken, rightNode), opToken);
        }
        return node;
    }

    parseFactor() { // Handles * /
        let node = this.parsePrimary();
        while (this.currentToken.type === TokenType.MULTIPLY || this.currentToken.type === TokenType.DIVIDE) {
            const opToken = this.currentToken;
            this.advance();
            const rightNode = this.parsePrimary();
            node = this.at(new BinaryOpNode(node, opToken, rightNode), opToken);
        }
        return node;
    }

    // name(argument, argument, ...)
    parseCall(callee) {
        this.eat(TokenType.LPAREN);
        const args = [];
        if (this.currentToken.type !== TokenType.RPAREN) {
            args.push(this.parseExpression());
            while (this.currentToken.type === TokenType.COMMA) {
                this.advance();
                args.push(this.parseExpression());
            }
        }
        this.eat(TokenType.RPAREN, "Arguments are separated by commas, and the list ends with ')'.");
        return this.at(new CallNode(callee, args), callee);
    }

    parsePrimary() { // Handles atoms, (expr), unary ops
        const token = this.currentToken;
        
        if (token.type === TokenType.NUMBER) {
            this.advance();
            return this.at(new NumberNode(token), token);
        }
        if (token.type === TokenType.STRING) {
            this.advance();
            return this.at(new StringNode(token), token);
        }
        if (token.type === TokenType.TRUE || token.type === TokenType.FALSE) {
            this.advance();
            return this.at(new BooleanNode(token), token);
        }
        if (token.type === TokenType.IDENTIFIER) {
            this.advance();
            const identifier = this.at(new IdentifierNode(token), token);
            if (this.currentToken.type === TokenType.LPAREN) return this.parseCall(identifier);
            return identifier;
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
            return this.at(new UnaryOpNode(token, rightNode), token);
        }
        const previous = this.previousToken?.type;
        if (token.type === TokenType.EQUALS && (previous === TokenType.LT || previous === TokenType.GT)) {
            const symbol = previous === TokenType.LT ? '<' : '>';
            throw this.error(`'${symbol}=' is not supported. Use '${symbol}' instead, for example i < 4 instead of i <= 3.`, this.previousToken);
        }
        throw this.error(UNEXPECTED_HINTS[token.type]?.(token)
            ?? `Didn't expect ${this.describe(token)} here. A value should go here: a number, "text", a variable name or a calculation.`);
    }
}