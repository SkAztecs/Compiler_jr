import React, { useEffect, useRef } from 'react';

/**
 * Shows the rows one compiler phase produced. Rows that came from the selected
 * source line are highlighted; clicking a row selects its source line.
 */
const PhaseView = ({ rows, selectedLine, onSelectLine, highlight = true }) => {
    const containerRef = useRef(null);

    // Bring the first highlighted row into view when the selection changes
    useEffect(() => {
        if (!highlight || !containerRef.current) return;
        const first = containerRef.current.querySelector('.phase-row.is-traced');
        if (first) first.scrollIntoView({ block: 'center' });
    }, [selectedLine, rows, highlight]);

    return (
        <div ref={containerRef}>
            {rows.map((row, index) => {
                const traced = highlight && row.line !== null && row.line === selectedLine;
                const clickable = highlight && row.line !== null;
                const className = [
                    'phase-row',
                    row.kind ? `phase-row--${row.kind}` : '',
                    clickable ? 'is-clickable' : '',
                    traced ? 'is-traced' : '',
                ].filter(Boolean).join(' ');
                return (
                    <span
                        key={index}
                        className={className}
                        onClick={clickable ? () => onSelectLine(row.line) : undefined}
                        title={clickable ? `From line ${row.line}` : undefined}
                    >
                        {row.text || ' '}
                    </span>
                );
            })}
        </div>
    );
};

export default PhaseView;
