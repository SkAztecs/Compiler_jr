// Ready-made keyword sets, so a student can switch the whole language in one click.
// Each word must be a single word (letters, marks, digits or _), and all ten must differ.
// These spellings are a starting point; native speakers may prefer other words, and
// every keyword can still be changed by hand in Settings.

const pack = (id, name, englishName, [let_, print, if_, else_, true_, false_, while_, for_, func, return_]) => ({
    id,
    name,
    englishName,
    keywords: {
        letKeyword: let_,
        printKeyword: print,
        ifKeyword: if_,
        elseKeyword: else_,
        trueKeyword: true_,
        falseKeyword: false_,
        whileKeyword: while_,
        forKeyword: for_,
        funcKeyword: func,
        returnKeyword: return_,
    },
});

export const LANGUAGE_PACKS = [
    pack('en', 'English', 'English', ['let', 'print', 'if', 'else', 'true', 'false', 'while', 'for', 'func', 'return']),
    pack('ta', 'தமிழ்', 'Tamil', ['மாறி', 'பதிப்பி', 'என்றால்', 'இல்லையெனில்', 'உண்மை', 'பொய்', 'வரை', 'சுழற்சி', 'செயல்', 'திருப்பு']),
    pack('hi', 'हिन्दी', 'Hindi', ['माना', 'छापो', 'अगर', 'वरना', 'सही', 'गलत', 'जबतक', 'दोहराओ', 'कार्य', 'लौटाओ']),
    pack('te', 'తెలుగు', 'Telugu', ['అనుకో', 'ముద్రించు', 'ఒకవేళ', 'లేకపోతే', 'నిజం', 'అబద్ధం', 'ఉన్నంతవరకు', 'పునరావృతం', 'విధి', 'తిరిగిఇవ్వు']),
    pack('kn', 'ಕನ್ನಡ', 'Kannada', ['ಇರಲಿ', 'ಮುದ್ರಿಸು', 'ಒಂದುವೇಳೆ', 'ಇಲ್ಲದಿದ್ದರೆ', 'ಸತ್ಯ', 'ಸುಳ್ಳು', 'ಎಲ್ಲಿಯವರೆಗೆ', 'ಪುನರಾವರ್ತಿಸು', 'ಕಾರ್ಯ', 'ಹಿಂತಿರುಗಿಸು']),
    pack('ml', 'മലയാളം', 'Malayalam', ['ഇരിക്കട്ടെ', 'കാണിക്കുക', 'എങ്കിൽ', 'അല്ലെങ്കിൽ', 'ശരി', 'തെറ്റ്', 'ഉള്ളിടത്തോളം', 'ആവർത്തിക്കുക', 'പ്രവൃത്തി', 'തിരികെനൽകുക']),
    pack('bn', 'বাংলা', 'Bengali', ['ধরি', 'দেখাও', 'যদি', 'নাহলে', 'সত্য', 'মিথ্যা', 'যতক্ষণ', 'পুনরাবৃত্তি', 'কাজ', 'ফেরত']),
    pack('mr', 'मराठी', 'Marathi', ['समजा', 'दाखव', 'जर', 'नाहीतर', 'खरे', 'खोटे', 'जोपर्यंत', 'पुनरावृत्ती', 'कार्य', 'परत']),
];

// The pack whose keywords match the current settings exactly, if any
export function findPack(settings) {
    return LANGUAGE_PACKS.find(({ keywords }) =>
        Object.entries(keywords).every(([key, word]) => (settings[key] || '').trim() === word)) ?? null;
}
