import React from 'react';

/**
 * Injects the global styles from the original <style> tag.
 */
const GlobalStyles = () => (
  <style>
    {`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500;600&display=swap');
      
      body {
        font-family: 'Inter', sans-serif;
      }
      
      textarea, pre {
        font-family: 'Fira Code', monospace;
        font-size: 0.9rem;
        line-height: 1.6;
      }

      /* Modal Animation */
      .fixed.inset-0 {
        opacity: 1;
      }
      .fixed.inset-0 > div {
        transform: scale(1);
        opacity: 1;
      }

    `}
  </style>
);

export default GlobalStyles;