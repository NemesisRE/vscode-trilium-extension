/**
 * Type declarations for vendored Trilium CKEditor plugins.
 * These modules are downloaded during build and may not have TypeScript support.
 */

// Allow importing SVG files with ?raw suffix
declare module '*.svg?raw' {
  const content: string;
  export default content;
}

// Allow importing CSS files
declare module '*.css' {
  const content: any;
  export default content;
}

// Allow mathlive imports (optional dependency)
declare module 'mathlive' {
  export const MathfieldElement: any;
  export default any;
}

declare module 'mathlive/fonts.css';
declare module 'mathlive/static.css';

// CKEditor 5 CSS
declare module 'ckeditor5/ckeditor5.css';
