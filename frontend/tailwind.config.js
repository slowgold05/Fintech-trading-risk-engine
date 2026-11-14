/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#111315", sidebar: "#15181B", surface: "#1B1F22",
        raised: "#24292D", hover: "#2D3337", line: "#343B3F",
        ink: "#F3F6F4", copy: "#C6CFCA", muted: "#98A39D",
        brand: { 100: "#D7F8E9", 300: "#67DEAA", 500: "#20B981", 700: "#117A59" },
        accent: { 300: "#FFC078", 500: "#F59E42", 700: "#B8661F" },
        up: "#67DEAA", down: "#F07A78", focus: "#8CEFC0",
      },
    },
  },
  plugins: [],
};
