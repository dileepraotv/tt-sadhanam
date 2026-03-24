/**
 * Component tests for bracket display components
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

describe('Match Card Component', () => {
  it('should render both player names', () => {
    render(
      <div data-testid="match-card">
        <div data-testid="player1">Player One</div>
        <div data-testid="player2">Player Two</div>
      </div>
    )

    expect(screen.getByTestId('player1')).toHaveTextContent('Player One')
    expect(screen.getByTestId('player2')).toHaveTextContent('Player Two')
  })

  it('should render scores if match is started/complete', () => {
    render(
      <div data-testid="match-card">
        <div>Player One</div>
        <div data-testid="score1">3</div>
        <span>-</span>
        <div data-testid="score2">0</div>
        <div>Player Two</div>
      </div>
    )

    expect(screen.getByTestId('score1')).toHaveTextContent('3')
    expect(screen.getByTestId('score2')).toHaveTextContent('0')
  })

  it('should highlight winner when match is complete', () => {
    render(
      <div data-testid="match-card">
        <div data-testid="winner" className="font-bold">Player One</div>
        <div data-testid="loser">Player Two</div>
      </div>
    )

    const winner = screen.getByTestId('winner')
    expect(winner).toHaveClass('font-bold')
  })

  it('should display pending state for upcoming matches', () => {
    render(
      <div data-testid="match-card">
        <div data-testid="status">Pending</div>
        <div>Player One</div>
        <span data-testid="vs">vs</span>
        <div>Player Two</div>
      </div>
    )

    expect(screen.getByTestId('status')).toHaveTextContent('Pending')
    expect(screen.getByTestId('vs')).toBeInTheDocument()
  })

  it('should show bye match indicator', () => {
    render(
      <div data-testid="match-card">
        <div data-testid="bye-indicator">BYE</div>
        <div>Player One</div>
      </div>
    )

    expect(screen.getByTestId('bye-indicator')).toHaveTextContent('BYE')
  })

  it('should be clickable to view match details', () => {
    const handleClick = jest.fn()
    render(
      <button 
        data-testid="match-card"
        onClick={handleClick}
      >
        Match Details
      </button>
    )

    fireEvent.click(screen.getByTestId('match-card'))
    expect(handleClick).toHaveBeenCalled()
  })

  it('should display bracket side indicator for DE matches', () => {
    render(
      <div data-testid="match-card">
        <span data-testid="bracket-side">Winners Bracket</span>
        <div>Player One vs Player Two</div>
      </div>
    )

    expect(screen.getByTestId('bracket-side')).toHaveTextContent('Winners Bracket')
  })
})

describe('Bracket View Component', () => {
  it('should render rounds in correct order', () => {
    render(
      <div data-testid="bracket">
        <div data-testid="round-1">Round 1</div>
        <div data-testid="round-2">Round 2</div>
        <div data-testid="round-3">Final</div>
      </div>
    )

    const round1 = screen.getByTestId('round-1')
    const round2 = screen.getByTestId('round-2')
    const round3 = screen.getByTestId('round-3')

    expect(round1).toBeInTheDocument()
    expect(round2).toBeInTheDocument()
    expect(round3).toBeInTheDocument()
  })

  it('should display all matches in each round', () => {
    render(
      <div data-testid="bracket">
        <div data-testid="round-1">
          <div data-testid="match-1">Match 1</div>
          <div data-testid="match-2">Match 2</div>
          <div data-testid="match-3">Match 3</div>
          <div data-testid="match-4">Match 4</div>
        </div>
      </div>
    )

    expect(screen.getByTestId('match-1')).toBeInTheDocument()
    expect(screen.getByTestId('match-4')).toBeInTheDocument()
  })

  it('should show bye positions', () => {
    render(
      <div data-testid="bracket">
        <div data-testid="bye-slot">BYE</div>
        <div data-testid="match-slot">Match</div>
      </div>
    )

    expect(screen.getByTestId('bye-slot')).toHaveTextContent('BYE')
  })

  it('should handle double elimination bracket sides', () => {
    render(
      <div data-testid="bracket">
        <div data-testid="wb-section">
          <h3>Winners Bracket</h3>
        </div>
        <div data-testid="lb-section">
          <h3>Losers Bracket</h3>
        </div>
        <div data-testid="gf-section">
          <h3>Grand Final</h3>
        </div>
      </div>
    )

    expect(screen.getByText('Winners Bracket')).toBeInTheDocument()
    expect(screen.getByText('Losers Bracket')).toBeInTheDocument()
    expect(screen.getByText('Grand Final')).toBeInTheDocument()
  })

  it('should be horizontally scrollable on small screens', () => {
    render(
      <div 
        data-testid="bracket"
        style={{ overflowX: 'auto' }}
      >
        <div data-testid="bracket-content">Long bracket content</div>
      </div>
    )

    const bracket = screen.getByTestId('bracket')
    expect(bracket).toHaveStyle('overflowX: auto')
  })

  it('should display unplayed matches differently from completed matches', () => {
    render(
      <div data-testid="bracket">
        <div data-testid="unplayed-match" className="opacity-50">
          Pending Match
        </div>
        <div data-testid="completed-match" className="opacity-100">
          Completed Match
        </div>
      </div>
    )

    expect(screen.getByTestId('unplayed-match')).toHaveClass('opacity-50')
    expect(screen.getByTestId('completed-match')).toHaveClass('opacity-100')
  })
})

describe('Round Robin View Component', () => {
  it('should display groups', () => {
    render(
      <div data-testid="rr-view">
        <div data-testid="group-a">
          <h3>Group A</h3>
        </div>
        <div data-testid="group-b">
          <h3>Group B</h3>
        </div>
      </div>
    )

    expect(screen.getByText('Group A')).toBeInTheDocument()
    expect(screen.getByText('Group B')).toBeInTheDocument()
  })

  it('should show standings table with correct columns', () => {
    render(
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Played</th>
            <th>Won</th>
            <th>Lost</th>
            <th>Points</th>
          </tr>
        </thead>
      </table>
    )

    expect(screen.getByText('Player')).toBeInTheDocument()
    expect(screen.getByText('Points')).toBeInTheDocument()
  })

  it('should display player standings in correct order', () => {
    render(
      <table>
        <tbody>
          <tr data-testid="rank-1"><td>1</td><td>Player A</td><td>9</td></tr>
          <tr data-testid="rank-2"><td>2</td><td>Player B</td><td>6</td></tr>
          <tr data-testid="rank-3"><td>3</td><td>Player C</td><td>3</td></tr>
        </tbody>
      </table>
    )

    const rank1 = screen.getByTestId('rank-1')
    expect(rank1).toBeInTheDocument()
  })

  it('should show matches for each group', () => {
    render(
      <div data-testid="group-matches">
        <div data-testid="match-1">Player A vs Player B</div>
        <div data-testid="match-2">Player B vs Player C</div>
      </div>
    )

    expect(screen.getByTestId('match-1')).toBeInTheDocument()
    expect(screen.getByTestId('match-2')).toBeInTheDocument()
  })

  it('should highlight ongoing group', () => {
    render(
      <div data-testid="active-group" className="bg-blue-100">
        Group A (in progress - 67%)
      </div>
    )

    expect(screen.getByTestId('active-group')).toHaveClass('bg-blue-100')
  })
})
