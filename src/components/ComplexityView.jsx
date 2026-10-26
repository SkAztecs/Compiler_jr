import React, { useCallback, useMemo } from 'react';
import PhaseView from './PhaseView';
import TutorPanel from './TutorPanel';
import { adviseComplexity, adviceRows } from '../compiler/advisor.js';
import { extractCode, verifySuggestion } from '../tutor/verify.js';

/**
 * The complexity advisor: Big-O estimates from the code, growth measured by
 * running it at several sizes, the busiest lines, and suggestions that are
 * checked on the VM before they are shown. The AI tutor can explain the report
 * and suggest better versions, which the compiler checks the same way.
 */
const ComplexityView = ({ build, selectedLine, onSelectLine, tutorStatus, tutorLanguage, tutorBase, onUseCode }) => {
    const rows = useMemo(() => adviceRows(build, adviseComplexity(build)), [build]);
    const report = useMemo(() => rows.map(row => row.text).join('\n'), [rows]);

    // Code in the tutor's answer is compiled and run next to the original before it is trusted
    const verify = useCallback((answer) => {
        const code = extractCode(answer);
        return code ? verifySuggestion(build, code) : null;
    }, [build]);

    return (
        <>
            <TutorPanel
                label="Explain the complexity with AI"
                status={tutorStatus}
                defaultLanguage={tutorLanguage}
                questionKey={build.source}
                makeRequest={() => ({ kind: 'complexity', ...tutorBase, facts: report })}
                verify={verify}
                onUseCode={onUseCode}
            />
            <PhaseView rows={rows} selectedLine={selectedLine} onSelectLine={onSelectLine} />
        </>
    );
};

export default ComplexityView;
