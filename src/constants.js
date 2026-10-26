// Default code for the editor
export const DEFAULT_CODE_EXAMPLE = `print("--- While Loop Example ---");
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
print(true || (1 / 0)); // Does not error

print("--- Unicode Variable Names ---");
let 变量 = 42;
let 日本語 = "こんにちは";
print(变量);
print(日本語);

print("--- Tamil Support ---");
let தமிழ் = "வணக்கம்";
let எண் = 100;
let மென்பொருள் = true;
print(தமிழ்);
print(எண்);
print(மென்பொருள்);`;