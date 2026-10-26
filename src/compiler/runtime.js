import { TokenType } from '../../token.js';

// Runtime rules the VM applies to values. They mirror the reference Evaluator
// exactly (same results, same error text) so the two can be cross-checked.

export const OPERATOR_SYMBOLS = {
    [TokenType.PLUS]: '+',
    [TokenType.MINUS]: '-',
    [TokenType.MULTIPLY]: '*',
    [TokenType.DIVIDE]: '/',
    [TokenType.EQ]: '==',
    [TokenType.NOT_EQ]: '!=',
    [TokenType.LT]: '<',
    [TokenType.GT]: '>',
    [TokenType.AND]: '&&',
    [TokenType.OR]: '||',
    [TokenType.BANG]: '!',
};

// Only false (and null) are falsy; 0 and "" count as true, as in the Evaluator
export function isTruthy(value) {
    return !(value === null || value === false);
}

function checkNumberOperands(symbol, leftVal, rightVal) {
    if (typeof leftVal !== 'number' || typeof rightVal !== 'number') {
        throw new Error(`Operator '${symbol}' needs two numbers, but got ${typeof leftVal} and ${typeof rightVal}.`);
    }
}

function checkComparableOperands(symbol, leftVal, rightVal) {
    const bothNumbers = typeof leftVal === 'number' && typeof rightVal === 'number';
    const bothStrings = typeof leftVal === 'string' && typeof rightVal === 'string';
    if (!bothNumbers && !bothStrings) {
        throw new Error(`Operator '${symbol}' compares two numbers or two strings, but got ${typeof leftVal} and ${typeof rightVal}.`);
    }
}

export function applyBinary(opType, leftVal, rightVal) {
    const symbol = OPERATOR_SYMBOLS[opType];
    switch (opType) {
        case TokenType.PLUS:
            if (typeof leftVal === 'string' || typeof rightVal === 'string') {
                return String(leftVal) + String(rightVal);
            }
            checkNumberOperands(symbol, leftVal, rightVal);
            return leftVal + rightVal;
        case TokenType.MINUS:
            checkNumberOperands(symbol, leftVal, rightVal);
            return leftVal - rightVal;
        case TokenType.MULTIPLY:
            checkNumberOperands(symbol, leftVal, rightVal);
            return leftVal * rightVal;
        case TokenType.DIVIDE:
            checkNumberOperands(symbol, leftVal, rightVal);
            if (rightVal === 0) throw new Error("Cannot divide by zero.");
            return leftVal / rightVal;
        case TokenType.EQ: return leftVal === rightVal;
        case TokenType.NOT_EQ: return leftVal !== rightVal;
        case TokenType.LT:
            checkComparableOperands(symbol, leftVal, rightVal);
            return leftVal < rightVal;
        case TokenType.GT:
            checkComparableOperands(symbol, leftVal, rightVal);
            return leftVal > rightVal;
        default: throw new Error(`Unknown binary operator: ${opType}`);
    }
}

export function applyUnary(opType, value) {
    switch (opType) {
        case TokenType.MINUS:
        case TokenType.PLUS:
            if (typeof value !== 'number') {
                throw new Error(`Operator '${OPERATOR_SYMBOLS[opType]}' needs a number, but got ${typeof value}.`);
            }
            return opType === TokenType.MINUS ? -value : value;
        case TokenType.BANG: return !isTruthy(value);
        default: throw new Error(`Unknown unary operator: ${opType}`);
    }
}

// How print() shows a value in the console
export function formatValue(value) {
    if (value === null) return 'null';
    return value.toString();
}
