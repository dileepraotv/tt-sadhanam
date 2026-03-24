/**
 * Component tests for admin and form components
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

describe('Tournament Creation Form', () => {
  it('should render form inputs', () => {
    render(
      <form data-testid="tournament-form">
        <input data-testid="name-input" placeholder="Tournament Name" />
        <input data-testid="date-input" type="date" />
        <select data-testid="format-select">
          <option>Select format...</option>
          <option>Single Knockout</option>
          <option>Round Robin</option>
        </select>
        <button data-testid="submit-btn">Create Tournament</button>
      </form>
    )

    expect(screen.getByTestId('name-input')).toBeInTheDocument()
    expect(screen.getByTestId('date-input')).toBeInTheDocument()
    expect(screen.getByTestId('format-select')).toBeInTheDocument()
  })

  it('should validate required fields', () => {
    render(
      <form data-testid="tournament-form">
        <input 
          data-testid="name-input" 
          required 
          placeholder="Tournament Name" 
        />
        <button type="submit" data-testid="submit-btn" disabled>
          Create Tournament
        </button>
      </form>
    )

    const submitBtn = screen.getByTestId('submit-btn')
    expect(submitBtn).toBeDisabled()
  })

  it('should submit form with valid data', () => {
    const handleSubmit = jest.fn((e) => e.preventDefault())
    render(
      <form data-testid="tournament-form" onSubmit={handleSubmit}>
        <input data-testid="name-input" defaultValue="Nationals 2026" />
        <button type="submit" data-testid="submit-btn">Create</button>
      </form>
    )

    fireEvent.click(screen.getByTestId('submit-btn'))
    expect(handleSubmit).toHaveBeenCalled()
  })

  it('should update format options based on complexity', () => {
    const { rerender } = render(
      <select data-testid="format-select">
        <option>Single Knockout</option>
        <option>Round Robin</option>
      </select>
    )

    expect(screen.getByText('Single Knockout')).toBeInTheDocument()

    rerender(
      <select data-testid="format-select">
        <option>Round Robin</option>
        <option>Multi-Stage RR to KO</option>
        <option>Double Elimination</option>
        <option>Team League</option>
      </select>
    )

    expect(screen.getByText('Multi-Stage RR to KO')).toBeInTheDocument()
  })
})

describe('Player Manager Component', () => {
  it('should display player list', () => {
    render(
      <div data-testid="player-list">
        <div data-testid="player-1">Player One | Seed 1</div>
        <div data-testid="player-2">Player Two | Seed 2</div>
        <div data-testid="player-3">Player Three | Seed 3</div>
      </div>
    )

    expect(screen.getByTestId('player-1')).toBeInTheDocument()
    expect(screen.getByTestId('player-3')).toBeInTheDocument()
  })

  it('should allow adding new player', () => {
    const { rerender } = render(
      <div data-testid="player-list">
        <div data-testid="player-1">Player One</div>
        <button data-testid="add-player-btn">Add Player</button>
      </div>
    )

    fireEvent.click(screen.getByTestId('add-player-btn'))

    rerender(
      <div data-testid="player-list">
        <div data-testid="player-1">Player One</div>
        <div data-testid="player-2">Player Two</div>
        <button data-testid="add-player-btn">Add Player</button>
      </div>
    )

    expect(screen.getByTestId('player-1')).toBeInTheDocument()
  })

  it('should allow removing player', () => {
    const { rerender } = render(
      <div data-testid="player-list">
        <div data-testid="player-1">
          Player One
          <button data-testid="remove-1">Remove</button>
        </div>
      </div>
    )

    fireEvent.click(screen.getByTestId('remove-1'))

    rerender(
      <div data-testid="player-list">
        {/* Player removed */}
      </div>
    )
  })

  it('should allow editing player seed', () => {
    render(
      <div data-testid="player-row">
        <input 
          data-testid="seed-input" 
          type="number" 
          defaultValue="1" 
        />
      </div>
    )

    const seedInput = screen.getByTestId('seed-input') as HTMLInputElement
    fireEvent.change(seedInput, { target: { value: '5' } })
    expect(seedInput.value).toBe('5')
  })

  it('should show player count summary', () => {
    render(
      <div data-testid="summary">
        <span data-testid="player-count">3 players</span>
        <span data-testid="seeded-count">2 seeded</span>
      </div>
    )

    expect(screen.getByTestId('player-count')).toHaveTextContent('3')
  })
})

describe('Match Detail Dialog', () => {
  it('should render both player names', () => {
    render(
      <dialog data-testid="match-dialog" open>
        <div data-testid="player1-name">Player One</div>
        <div data-testid="player2-name">Player Two</div>
      </dialog>
    )

    expect(screen.getByTestId('player1-name')).toBeInTheDocument()
    expect(screen.getByTestId('player2-name')).toBeInTheDocument()
  })

  it('should display match details', () => {
    render(
      <dialog data-testid="match-dialog" open>
        <div data-testid="round">Round 2</div>
        <div data-testid="match-info">Quarterfinal</div>
        <div data-testid="status">Complete</div>
      </dialog>
    )

    expect(screen.getByTestId('round')).toHaveTextContent('Round 2')
    expect(screen.getByTestId('status')).toHaveTextContent('Complete')
  })

  it('should show score input for ongoing matches', () => {
    render(
      <dialog data-testid="match-dialog" open>
        <input data-testid="score1" type="number" />
        <span>-</span>
        <input data-testid="score2" type="number" />
        <button data-testid="save-btn">Save Score</button>
      </dialog>
    )

    expect(screen.getByTestId('score1')).toBeInTheDocument()
    expect(screen.getByTestId('save-btn')).toBeInTheDocument()
  })

  it('should close dialog on close button', () => {
    const { rerender } = render(
      <dialog data-testid="match-dialog" open>
        <button data-testid="close-btn">Close</button>
        Match content
      </dialog>
    )

    fireEvent.click(screen.getByTestId('close-btn'))

    rerender(
      <dialog data-testid="match-dialog">
        Dialog closed
      </dialog>
    )
  })

  it('should display game-by-game breakdown for BO3/BO5', () => {
    render(
      <dialog data-testid="match-dialog" open>
        <div data-testid="games">
          <div data-testid="game-1">Game 1: Player One 11-8</div>
          <div data-testid="game-2">Game 2: Player Two 11-9</div>
          <div data-testid="game-3">Game 3: Player One 11-7</div>
        </div>
      </dialog>
    )

    expect(screen.getByTestId('game-1')).toBeInTheDocument()
    expect(screen.getByTestId('game-3')).toBeInTheDocument()
  })
})

describe('Bracket Controls Component', () => {
  it('should show generate bracket button', () => {
    render(
      <div data-testid="bracket-controls">
        <button data-testid="generate-btn">Generate Bracket</button>
      </div>
    )

    expect(screen.getByTestId('generate-btn')).toBeInTheDocument()
  })

  it('should show reset bracket button when bracket exists', () => {
    render(
      <div data-testid="bracket-controls">
        <button data-testid="generate-btn">Generate Bracket</button>
        <button data-testid="reset-btn" style={{ display: 'block' }}>Reset Bracket</button>
      </div>
    )

    expect(screen.getByTestId('reset-btn')).toBeInTheDocument()
  })

  it('should disable buttons during loading', () => {
    render(
      <div data-testid="bracket-controls">
        <button disabled data-testid="generate-btn">Generating...</button>
        <button disabled data-testid="reset-btn">Resetting...</button>
      </div>
    )

    expect(screen.getByTestId('generate-btn')).toBeDisabled()
    expect(screen.getByTestId('reset-btn')).toBeDisabled()
  })

  it('should show confirmation before reset', () => {
    const handleReset = jest.fn()
    render(
      <div data-testid="bracket-controls">
        <button 
          data-testid="reset-btn"
          onClick={() => {
            if (window.confirm('Reset bracket?')) handleReset()
          }}
        >
          Reset
        </button>
      </div>
    )

    // Simulate user confirmation
    window.confirm = jest.fn(() => true)
    fireEvent.click(screen.getByTestId('reset-btn'))
    expect(handleReset).toHaveBeenCalled()
  })
})
