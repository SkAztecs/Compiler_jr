// The syntax guide shown in the "Syntax & Help" panel.
// Examples are written with the English keywords and converted to the student's
// chosen language when shown. In the text, {let}, {print} and so on are replaced by
// the keyword as it is spelled in that language. `backticks` mark code.
// Every example is compiled in every language pack by the tests.

export const GUIDE_SECTIONS = [
    {
        id: 'first-program',
        title: 'Your first program',
        text: [
            'A program is a list of statements that run from top to bottom. End each statement with `;`.',
            '`{print}(value)` shows one value in the console.',
            'Anything after `//` on a line is a comment: the compiler ignores it, so use it to leave notes.',
        ],
        example: `// My first program
print("Hello!");
print(1 + 2);`,
    },
    {
        id: 'values',
        title: 'Values: numbers, text, true and false',
        text: [
            'Numbers are written as usual: `42`, `3.5`, `-7`.',
            'Text goes inside double quotes: `"hello"`. It can use any script, like Tamil or Hindi. Single quotes do not work.',
            '`{true}` and `{false}` are the two yes/no values.',
        ],
        example: `print(42);
print(3.5);
print("வணக்கம் नमस्ते");
print(true);`,
    },
    {
        id: 'variables',
        title: 'Variables',
        text: [
            '`{let} name = value;` creates a variable. It always needs a starting value.',
            'To change it later, leave out `{let}`: `name = value;`.',
            'Names can use letters from any script, digits and `_`, but cannot start with a digit. Capital letters matter: `Total` and `total` are different names.',
            'A variable must be created before it is used.',
        ],
        example: `let score = 10;
score = score + 5;
print(score);

let பெயர் = "Ravi";
print(பெயர்);`,
    },
    {
        id: 'arithmetic',
        title: 'Arithmetic and joining text',
        text: [
            '`+` `-` `*` `/` work as in maths: `*` and `/` happen before `+` and `-`. Use `( )` to change the order.',
            '`/` gives decimals: `7 / 2` is `3.5`. Dividing by zero stops the program with an error.',
            '`+` with text joins it: `"Age: " + 15` gives `Age: 15`.',
            'There is no `++` or `+=`. To add one, write `count = count + 1;`.',
        ],
        example: `print(2 + 3 * 4);
print((2 + 3) * 4);
print(7 / 2);

let age = 15;
print("Age: " + age);`,
    },
    {
        id: 'comparisons',
        title: 'Comparing and combining conditions',
        text: [
            '`==` (equal), `!=` (not equal), `<` and `>` compare two values and give `{true}` or `{false}`.',
            'There is no `<=` or `>=`: instead of `i <= 3`, write `i < 4`.',
            '`==` is strict: `"1" == 1` is `{false}`, because text is never equal to a number.',
            '`&&` means "and", `||` means "or", `!` means "not". `&&` and `||` stop as soon as the answer is known.',
            'Only `{false}` counts as false. `0` and `""` count as true.',
        ],
        example: `let marks = 72;
print(marks > 50);
print(marks == 100);
print(marks > 50 && marks < 75);
print(!(marks < 35));`,
    },
    {
        id: 'if-else',
        title: 'Making decisions: if and else',
        text: [
            'The condition goes inside `( )` and the code to run goes inside `{ }`. The braces are needed even for one line.',
            '`{else} {if}` checks another condition when the first one was false; `{else}` runs when none of them were true.',
        ],
        example: `let marks = 72;
if (marks > 89) {
    print("Grade A");
} else if (marks > 59) {
    print("Grade B");
} else {
    print("Keep practising");
}`,
    },
    {
        id: 'while',
        title: 'Repeating: while',
        text: [
            '`{while} (condition) { ... }` repeats the block as long as the condition is true.',
            'Make sure something inside changes the condition, or the loop never ends. The compiler stops a loop after 1,000,000 passes.',
        ],
        example: `let count = 3;
while (count > 0) {
    print(count);
    count = count - 1;
}
print("Go!");`,
    },
    {
        id: 'for',
        title: 'Repeating: for',
        text: [
            '`{for} (start; condition; update) { ... }` is a shorter way to write a counting loop.',
            'The start runs once, the condition is checked before every pass, and the update runs after every pass.',
            'A variable created in the start only exists inside the loop. Any of the three parts can be left empty.',
        ],
        example: `let total = 0;
for (let i = 1; i < 6; i = i + 1) {
    total = total + i;
}
print("1 + 2 + 3 + 4 + 5 = " + total);`,
    },
    {
        id: 'blocks',
        title: 'Blocks and scope',
        text: [
            '`{ }` makes a block. A variable created inside a block only exists inside it.',
            'Inside a block you can create a new variable with the same name as one outside. It hides the outer one until the block ends.',
        ],
        example: `let x = 1;
{
    let x = 2;
    print(x);
}
print(x);`,
    },
    {
        id: 'functions',
        title: 'Functions',
        text: [
            '`{func} name(a, b) { ... }` creates a function: a named piece of code you can run again and again with different values.',
            'Call it by its name with values in `( )`, like `square(7)`. The values go into the parameters in order.',
            '`{return} value;` gives a value back to the place that called the function. A function without a `{return}` value just does a job, like printing; call it on its own line.',
            'A function can only use its parameters and the variables it creates itself. To use a value from the main program, pass it in.',
            'Functions are created at the top level of the program, and can be called before the line that defines them. A function can even call itself (recursion).',
        ],
        example: `func square(n) {
    return n * n;
}

func greet(name) {
    print("Hello, " + name + "!");
}

greet("Ravi");
print(square(7));

func factorial(n) {
    if (n < 2) {
        return 1;
    }
    return n * factorial(n - 1);
}
print(factorial(5));`,
    },
];

// Things beginners often try that this language does not have: [instead of, write, why]
export const NOT_SUPPORTED = [
    ['i++  or  i += 1', 'i = i + 1', 'there are no shortcut operators'],
    ['i <= 10', 'i < 11', 'there is no <= or >='],
    ["'text'", '"text"', 'text uses double quotes only'],
    ['print(a, b)', 'print(a + " " + b)', 'print shows one value; join with +'],
    ['if (x = 5)', 'if (x == 5)', '= changes x, == compares'],
    ['a % b', '', 'not available yet'],
    ['lists like [1, 2]', '', 'not available yet'],
];
