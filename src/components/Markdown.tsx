'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Renderizador markdown compartido. Antes las salidas se pintaban como texto
 * plano dentro de un contenedor con clases `prose`, así que las tablas, listas
 * y bloques de código de los agentes se veían con los asteriscos y las tuberías
 * a la vista.
 */
export const Markdown: React.FC<MarkdownProps> = ({ children, className = '' }) => (
  <div className={`markdown-body text-xs leading-relaxed ${className}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className: codeClass, children: codeChildren, ...props }) {
          const isBlock = /language-/.test(codeClass || '');
          if (isBlock) {
            return (
              <code className={codeClass} {...props}>
                {codeChildren}
              </code>
            );
          }
          return (
            <code
              className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[11px]"
              {...props}
            >
              {codeChildren}
            </code>
          );
        },
        a({ children: linkChildren, ...props }) {
          return (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {linkChildren}
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);
