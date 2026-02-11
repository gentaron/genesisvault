/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                'warm-white': '#FAF9F6',
                'soft-beige': '#F5F1E8',
                'gentle-green': '#A8C5A3',
                'lavender-mist': '#C8B8DB',
                'charcoal': '#2D2D2D',
            },
            fontFamily: {
                'serif-jp': ['"Noto Serif JP"', 'serif'],
                'sans-jp': ['"Noto Sans JP"', 'sans-serif'],
            },
            typography: (theme) => ({
                DEFAULT: {
                    css: {
                        color: theme('colors.charcoal'),
                        lineHeight: '1.85',
                        a: {
                            color: theme('colors.gentle-green'),
                            '&:hover': {
                                color: theme('colors.lavender-mist'),
                            },
                        },
                        h1: {
                            fontFamily: theme('fontFamily.serif-jp').join(', '),
                        },
                        h2: {
                            fontFamily: theme('fontFamily.serif-jp').join(', '),
                        },
                    },
                },
            }),
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
