import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Calibri as primary — system font, no download needed
        sans:    ['Calibri', 'Trebuchet MS', 'Gill Sans', 'Arial', 'sans-serif'],
        display: ['Calibri', 'Trebuchet MS', 'Arial', 'sans-serif'],
        mono:    ['Consolas', 'Monaco', 'Courier New', 'monospace'],
      },
      fontSize: {
        // Shift all standard sizes up by ~2pt to honour the +2pt request
        xs:   ['13px', { lineHeight: '18px' }],
        sm:   ['15px', { lineHeight: '22px' }],
        base: ['17px', { lineHeight: '26px' }],
        lg:   ['19px', { lineHeight: '28px' }],
        xl:   ['21px', { lineHeight: '30px' }],
        '2xl':['25px', { lineHeight: '34px' }],
        '3xl':['31px', { lineHeight: '40px' }],
        '4xl':['37px', { lineHeight: '46px' }],
        '5xl':['51px', { lineHeight: '58px' }],
      },
      colors: {
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        card:        { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover:     { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        primary:     { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary:   { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted:       { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent:      { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        border: 'hsl(var(--border))',
        input:  'hsl(var(--input))',
        ring:   'hsl(var(--ring))',
        // ICICI orange palette
        orange: {
          50:  '#FEF0E8',
          100: '#FDE8DA',
          200: '#FAD4BB',
          300: '#F5B08A',
          400: '#F07D49',
          500: '#F06321',   /* main ICICI orange */
          600: '#C94E18',
          700: '#A03D12',
          800: '#7A2E0D',
          900: '#551F08',
        },
        // Keep cyan for live indicators
        cyan: { 400: '#22d3ee', 500: '#06b6d4' },
        amber: { 400: '#fbbf24', 500: '#f59e0b' },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' },                              to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
      boxShadow: {
        'orange-glow': '0 0 20px rgba(240,99,33,0.30)',
        'card': '0 2px 12px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
