import React, { useState, useEffect } from 'react';
import './LandingPage.css';

const LandingPage = ({ onEnter }) => {
    const [currentConcept, setCurrentConcept] = useState(0);
    const [isVisible, setIsVisible] = useState(false);
    const [itemsVisible, setItemsVisible] = useState([]);

    const concepts = [
        {
            title: "The Conveyor Belt",
            subtitle: "A QUEUE",
            description: "The Lexer reads your code and cuts it into tokens, putting them in order onto a conveyor belt. The Parser picks them up in the exact same order.",
            simpleTerm: "This is a Queue - First-In, First-Out (FIFO)",
            example: "let x = 10; → [let, x, =, 10, ;]"
        },
        {
            title: "The Set of Labeled Boxes",
            subtitle: "A HASH TABLE",
            description: "How does your program remember x is 10? The Environment uses labeled boxes. When you type 'let x = 10', it grabs an empty box, labels it 'x', and puts 10 inside.",
            simpleTerm: "This is a Hash Table - incredibly fast at finding a box by its label",
            example: "x → 10 (instant lookup)"
        },
        {
            title: "The Family Tree",
            subtitle: "A TREE",
            description: "The computer needs to understand hierarchy. The Parser builds a 'family tree' of the code's logic. For '10 + 2 * 5', the + is the parent, with 10 and * as children.",
            simpleTerm: "This is an Abstract Syntax Tree (AST) - storing code's structure and hierarchy",
            example: "10 + 2 * 5 → Tree structure"
        },
        {
            title: "Asking the Family Tree",
            subtitle: "TREE TRAVERSAL",
            description: "The Evaluator visits children first to get their values before solving the parent. It goes to +, who needs his kids' values, then to *, who needs his kids' values, then gets 2 and 5.",
            simpleTerm: "This is Tree Traversal - visiting children before parents",
            example: "Bottom-up: 2, 5 → * → 10, 10 → + → 20"
        },
        {
            title: "The Stack of Boxes",
            subtitle: "A STACK",
            description: "How does your program know which x to use? It uses a Stack of labeled boxes. When entering a block, it creates a NEW set of boxes on top. When the block ends, it throws away the top set.",
            simpleTerm: "This is a Stack - handling 'local' variables and scoping",
            example: "Global x=10 → Block x=5 → After block: x=10"
        }
    ];

    useEffect(() => {
        setIsVisible(true);
        setItemsVisible([true]);
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentConcept((prev) => {
                const next = (prev + 1) % concepts.length;
                setItemsVisible([]);
                setTimeout(() => {
                    setItemsVisible([true]);
                }, 300);
                return next;
            });
        }, 5000);

        return () => clearInterval(interval);
    }, [concepts.length]);

    const handleEnter = () => {
        setIsVisible(false);
        setTimeout(() => {
            onEnter();
        }, 500);
    };

    const current = concepts[currentConcept];

    return (
        <div className={`landing-page ${isVisible ? 'visible' : ''}`}>
            <div className="landing-content">
                <div className={`landing-header ${isVisible ? 'fade-in' : ''}`}>
                    <h1 className="landing-title">
                        <span className="title-gradient">Programming Language</span>
                    </h1>
                    <h2 className="landing-subtitle">Native Language Interpreter</h2>
                    <p className="landing-description">
                        An interactive interpreter that demonstrates core Data Structures and Algorithms
                        concepts through a working programming language implementation.
                    </p>
                </div>
                <div className="concept-showcase">
                    <div className="concept-indicators">
                        {concepts.map((_, index) => (
                            <button
                                key={index}
                                className={`indicator ${currentConcept === index ? 'active' : ''}`}
                                onClick={() => {
                                    setCurrentConcept(index);
                                    setItemsVisible([]);
                                    setTimeout(() => setItemsVisible([true]), 300);
                                }}
                                aria-label={`Go to concept ${index + 1}`}
                            />
                        ))}
                    </div>

                    <div className={`concept-card ${itemsVisible[0] ? 'slide-in' : ''}`}>
                        <div className="concept-header">
                            <span className="concept-number">{String(currentConcept + 1).padStart(2, '0')} / {String(concepts.length).padStart(2, '0')}</span>
                            <h3 className="concept-title">{current.title}</h3>
                            <span className="concept-subtitle">{current.subtitle}</span>
                        </div>
                        
                        <div className="concept-body">
                            <p className="concept-description">{current.description}</p>
                            <div className="concept-highlight">
                                <strong>Simple Term:</strong> {current.simpleTerm}
                            </div>
                            <div className="concept-example">
                                <code>{current.example}</code>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`landing-actions ${isVisible ? 'fade-in-delay' : ''}`}>
                    <button className="btn-enter" onClick={handleEnter}>
                        <span>Enter Interpreter</span>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <path d="M7.5 15L12.5 10L7.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                </div>

                <div className={`landing-creators ${isVisible ? 'fade-in-delay' : ''}`}>
                    <div className="creators-label">Created by</div>
                    <div className="creators-list">
                        <span className="creator-name">JAIVARSHAN V</span>
                        <span className="creator-id">(24BCI0063)</span>
                    </div>
                    <div className="creators-list">
                        <span className="creator-name">SHREEKRISSH RL</span>
                        <span className="creator-id">(24BCE0724)</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LandingPage;

