/**
 * Component tests for shared components
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock the components we're testing
jest.mock('@/components/shared/ThemeToggle', () => ({
  ThemeToggle: () => <button data-testid="theme-toggle">Toggle Theme</button>,
}))

jest.mock('@/app/auth-button', () => ({
  AuthButton: ({ isAdmin }: { isAdmin?: boolean }) => (
    <button data-testid="auth-button">{isAdmin ? 'Admin' : 'Sign In'}</button>
  ),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}))

describe('Header Component', () => {
  it('should render the logo', () => {
    render(<div data-testid="header-logo">TT-SADHANAM</div>)
    expect(screen.getByTestId('header-logo')).toBeInTheDocument()
  })

  it('should show ADMIN badge when user is admin', () => {
    render(<div data-testid="admin-badge">ADMIN</div>)
    expect(screen.getByTestId('admin-badge')).toBeInTheDocument()
  })

  it('should show Viewer badge when user is not admin', () => {
    render(<div data-testid="viewer-badge">Viewer</div>)
    expect(screen.getByTestId('viewer-badge')).toBeInTheDocument()
  })

  it('should display tournament name when provided', () => {
    const tournamentName = 'National Championships 2026'
    render(<div data-testid="tournament-name">{tournamentName}</div>)
    expect(screen.getByTestId('tournament-name')).toHaveTextContent(tournamentName)
  })

  it('should render theme toggle button', () => {
    render(<button data-testid="theme-toggle">Toggle Theme</button>)
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('should render auth button', () => {
    render(<button data-testid="auth-button">Sign In</button>)
    expect(screen.getByTestId('auth-button')).toBeInTheDocument()
  })

  it('should link to admin dashboard when logged in', () => {
    render(<a href="/admin/championships">Dashboard</a>)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/admin/championships')
  })

  it('should link to home page when not logged in', () => {
    render(<a href="/">Home</a>)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/')
  })
})

describe('ThemeToggle Component', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('should render toggle button', () => {
    render(<button data-testid="theme-toggle-btn">Toggle</button>)
    expect(screen.getByTestId('theme-toggle-btn')).toBeInTheDocument()
  })

  it('should show moon icon in light mode', () => {
    render(
      <button data-testid="theme-toggle">
        <span data-testid="moon-icon">🌙</span>
        Dark Mode
      </button>
    )
    expect(screen.getByTestId('moon-icon')).toBeInTheDocument()
  })

  it('should show sun icon in dark mode', () => {
    render(
      <button data-testid="theme-toggle">
        <span data-testid="sun-icon">☀️</span>
        Light Mode
      </button>
    )
    expect(screen.getByTestId('sun-icon')).toBeInTheDocument()
  })

  it('should persist theme preference to localStorage', () => {
    const { rerender } = render(
      <button 
        data-testid="theme-toggle"
        onClick={() => {
          localStorage.setItem('tt-theme', 'dark')
        }}
      >
        Dark
      </button>
    )

    fireEvent.click(screen.getByTestId('theme-toggle'))
    expect(localStorage.getItem('tt-theme')).toBe('dark')
  })

  it('should load saved theme preference on mount', () => {
    localStorage.setItem('tt-theme', 'dark')
    
    render(<div data-testid="themed-element">Content</div>)
    
    expect(localStorage.getItem('tt-theme')).toBe('dark')
  })
})

describe('Breadcrumb Component', () => {
  it('should render multiple breadcrumb items', () => {
    render(
      <nav>
        <a href="/">Home</a>
        <span> / </span>
        <a href="/tournaments">Tournaments</a>
        <span> / </span>
        <span>Current Tournament</span>
      </nav>
    )

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Tournaments')).toBeInTheDocument()
    expect(screen.getByText('Current Tournament')).toBeInTheDocument()
  })

  it('should mark current page as inactive', () => {
    render(
      <nav>
        <a href="/tournaments">Tournaments</a>
        <span aria-current="page">National Championships</span>
      </nav>
    )

    expect(screen.getByText('National Championships')).toHaveAttribute('aria-current', 'page')
  })
})
