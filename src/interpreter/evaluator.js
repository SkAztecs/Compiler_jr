import { TokenType } from '../../token.js';
import {
    ProgramNode,
    BlockStatementNode,
    LetStatementNode,
    AssignmentNode,
    PrintStatementNode,
    IfStatementNode,
    WhileLoopNode,
    ForLoopNode,
    BinaryOpNode,
    UnaryOpNode,
    IdentifierNode,
    NumberNode,
    StringNode,
    BooleanNode,
    FunctionDeclarationNode,
    ReturnStatementNode,
    CallNode
} from '../../ast.js';

// Stops a runaway loop with an error instead of freezing the page
export const MAX_LOOP_ITERATIONS = 1000000;

// Stops recursion that never ends: calls nested deeper than this are an error
export const MAX_CALL_DEPTH = 1000;

export function callDepthError(name) {
    return `Too many function calls inside each other (more than ${MAX_CALL_DEPTH}). Does '${name}' keep calling itself without stopping?`;
}

export function missingReturnError(name) {
    return `Function '${name}' reached its end without a return. It gives back a value on other paths, so every path needs a return.`;
}

// Carries a return value out of a function body, through any loops and blocks
class ReturnSignal {
    constructor(value) { this.value = value; }
}

// True when a function gives back a value somewhere (return x;), not just 'return;'
export function returnsValue(node) {
    if (node instanceof ReturnStatementNode) return node.expression !== null;
    if (node instanceof BlockStatementNode) return node.statements.some(returnsValue);
    if (node instanceof IfStatementNode) return returnsValue(node.consequence) || (node.alternative !== null && returnsValue(node.alternative));
    if (node instanceof WhileLoopNode || node instanceof ForLoopNode) return returnsValue(node.body);
    return false;
}

// Symbols used in type-error messages
const OPERATOR_SYMBOLS = {
    [TokenType.PLUS]: '+',
    [TokenType.MINUS]: '-',
    [TokenType.MULTIPLY]: '*',
    [TokenType.DIVIDE]: '/',
    [TokenType.LT]: '<',
    [TokenType.GT]: '>',
};

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

export class Evaluator {
    constructor(outputLogger) {
        this.outputLogger = outputLogger;
        this.functions = new Map(); // name -> FunctionDeclarationNode
        this.depth = 0;             // how many calls are running inside each other
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
        } else if (node instanceof FunctionDeclarationNode) {
            return null; // already defined before the program started (see evalProgram)
        } else if (node instanceof ReturnStatementNode) {
            throw new ReturnSignal(node.expression ? this.evaluate(node.expression, env) : null);
        } else if (node instanceof CallNode) {
            return this.evalCall(node, env);
        
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
        // Functions can be called before the line that defines them
        for (const statement of node.statements) {
            if (statement instanceof FunctionDeclarationNode) this.functions.set(statement.name.value, statement);
        }
        let result = null;
        for (const statement of node.statements) {
            result = this.evaluate(statement, env);
        }
        return result;
    }

    evalCall(node, env) {
        const fn = this.functions.get(node.callee.value);
        if (!fn) throw new Error(`Function '${node.callee.value}' not defined.`);
        // Arguments are worked out left to right, in the caller's environment
        const args = node.args.map(arg => this.evaluate(arg, env));
        if (++this.depth > MAX_CALL_DEPTH) {
            this.depth = 0;
            throw new Error(callDepthError(fn.name.value));
        }
        // (Module 1) A new environment with no outer scope: a function sees only its parameters
        const callEnv = new Environment();
        fn.params.forEach((param, index) => callEnv.set(param.value, args[index]));
        try {
            this.evaluate(fn.body, callEnv);
        } catch (signal) {
            if (signal instanceof ReturnSignal) {
                this.depth--;
                return signal.value;
            }
            throw signal;
        }
        this.depth--;
        if (returnsValue(fn.body)) throw new Error(missingReturnError(fn.name.value));
        return null;
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

    checkLoopLimit(iterations) {
        if (iterations > MAX_LOOP_ITERATIONS) {
            throw new Error(`Loop stopped after ${MAX_LOOP_ITERATIONS} iterations. Check that its condition eventually becomes false.`);
        }
    }

    evalWhileLoop(node, env) {
        let result = null;
        let iterations = 0;
        while (this.isTruthy(this.evaluate(node.condition, env))) {
            this.checkLoopLimit(++iterations);
            result = this.evaluate(node.body, env);
        }
        return result;
    }

    evalForLoop(node, env) {
        const forEnv = new Environment(env); // (Module 1/4) New scope
        let result = null;
        let iterations = 0;

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

            this.checkLoopLimit(++iterations);
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
                this.checkNumberOperands(node.op, leftVal, rightVal);
                return leftVal + rightVal;
            case TokenType.MINUS:
                this.checkNumberOperands(node.op, leftVal, rightVal);
                return leftVal - rightVal;
            case TokenType.MULTIPLY:
                this.checkNumberOperands(node.op, leftVal, rightVal);
                return leftVal * rightVal;
            case TokenType.DIVIDE:
                this.checkNumberOperands(node.op, leftVal, rightVal);
                if (rightVal === 0) throw new Error("Cannot divide by zero.");
                return leftVal / rightVal;

            case TokenType.EQ: return leftVal === rightVal;
            case TokenType.NOT_EQ: return leftVal !== rightVal;
            case TokenType.LT:
                this.checkComparableOperands(node.op, leftVal, rightVal);
                return leftVal < rightVal;
            case TokenType.GT:
                this.checkComparableOperands(node.op, leftVal, rightVal);
                return leftVal > rightVal;

            default: throw new Error(`Unknown binary operator: ${node.op.type}`);
        }
    }

    // Arithmetic needs numbers; without this check JavaScript silently gives NaN
    checkNumberOperands(op, leftVal, rightVal) {
        if (typeof leftVal !== 'number' || typeof rightVal !== 'number') {
            throw new Error(`Operator '${OPERATOR_SYMBOLS[op.type]}' needs two numbers, but got ${typeof leftVal} and ${typeof rightVal}.`);
        }
    }

    // < and > compare two numbers or two strings, never a mix
    checkComparableOperands(op, leftVal, rightVal) {
        const bothNumbers = typeof leftVal === 'number' && typeof rightVal === 'number';
        const bothStrings = typeof leftVal === 'string' && typeof rightVal === 'string';
        if (!bothNumbers && !bothStrings) {
            throw new Error(`Operator '${OPERATOR_SYMBOLS[op.type]}' compares two numbers or two strings, but got ${typeof leftVal} and ${typeof rightVal}.`);
        }
    }

    evalUnaryOp(node, env) {
        const rightVal = this.evaluate(node.right, env);
        switch(node.op.type) {
            case TokenType.MINUS:
            case TokenType.PLUS:
                if (typeof rightVal !== 'number') {
                    throw new Error(`Operator '${OPERATOR_SYMBOLS[node.op.type]}' needs a number, but got ${typeof rightVal}.`);
                }
                return node.op.type === TokenType.MINUS ? -rightVal : rightVal;
            case TokenType.BANG: return !this.isTruthy(rightVal);
            default: throw new Error(`Unknown unary operator: ${node.op.type}`);
        }
    }
}

export { Environment };