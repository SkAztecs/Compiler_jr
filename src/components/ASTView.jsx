import React, { useEffect, useRef, useState } from 'react';

/**
 * One node of the syntax tree. The arrow folds and unfolds its children;
 * clicking the label selects the source line the node came from.
 */
const ASTNodeView = ({ tree, edge, selectedLine, onSelectLine }) => {
    const [open, setOpen] = useState(true);
    const hasChildren = tree.children.length > 0;
    const traced = tree.line !== null && tree.line === selectedLine;

    return (
        <li className="ast-node">
            <div className={`ast-row${traced ? ' is-traced' : ''}`}>
                {hasChildren ? (
                    <button
                        className="ast-toggle"
                        onClick={() => setOpen(!open)}
                        aria-label={open ? 'Fold' : 'Unfold'}
                        aria-expanded={open}
                    >
                        {open ? '▾' : '▸'}
                    </button>
                ) : (
                    <span className="ast-toggle" aria-hidden="true">·</span>
                )}
                <span
                    className="ast-label"
                    onClick={tree.line !== null ? () => onSelectLine(tree.line) : undefined}
                >
                    {edge && <span className="ast-edge">{edge}: </span>}
                    {tree.label}
                    {tree.line !== null && <span className="ast-line"> line {tree.line}</span>}
                </span>
            </div>
            {hasChildren && open && (
                <ul className="ast-children">
                    {tree.children.map((child, index) => (
                        <ASTNodeView
                            key={index}
                            tree={child.tree}
                            edge={child.edge}
                            selectedLine={selectedLine}
                            onSelectLine={onSelectLine}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
};

/**
 * The parser's output as a foldable tree.
 */
const ASTView = ({ tree, selectedLine, onSelectLine }) => {
    const containerRef = useRef(null);

    // Bring the first node from the selected line into view
    useEffect(() => {
        const first = containerRef.current?.querySelector('.ast-row.is-traced');
        if (first) first.scrollIntoView({ block: 'center' });
    }, [selectedLine, tree]);

    return (
        <div ref={containerRef}>
            <span className="phase-row phase-row--header">--- Abstract Syntax Tree ---</span>
            <span className="phase-row phase-row--note">The parser turns the tokens into this tree. It looks the same whatever language your keywords are in.</span>
            <span className="phase-row phase-row--note">Click a node to trace its line; click an arrow to fold it.</span>
            <span className="phase-row phase-row--note"> </span>
            <ul className="ast-tree">
                <ASTNodeView tree={tree} edge={null} selectedLine={selectedLine} onSelectLine={onSelectLine} />
            </ul>
        </div>
    );
};

export default ASTView;
