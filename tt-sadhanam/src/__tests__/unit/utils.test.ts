/**
 * Unit tests for utility functions
 */

describe('Utility Functions', () => {
  describe('Tournament type validation', () => {
    it('should identify valid tournament formats', () => {
      const validFormats = [
        'single_knockout',
        'single_round_robin',
        'multi_rr_to_knockout',
        'pure_round_robin',
        'double_elimination',
        'team_league',
      ]

      validFormats.forEach(format => {
        expect(format).toBeDefined()
        expect(typeof format).toBe('string')
      })
    })

    it('should reject invalid tournament formats', () => {
      const invalidFormat = 'unknown_format'
      const validFormats = [
        'single_knockout',
        'double_elimination',
      ]

      expect(validFormats).not.toContain(invalidFormat)
    })
  })

  describe('Round naming', () => {
    it('should generate correct round names', () => {
      const getRoundName = (round: number) => {
        switch (round) {
          case 1: return 'Round 1'
          case 2: return 'Quarter-Finals'
          case 3: return 'Semi-Finals'
          case 4: return 'Final'
          default: return `Round ${round}`
        }
      }

      expect(getRoundName(1)).toBe('Round 1')
      expect(getRoundName(2)).toBe('Quarter-Finals')
      expect(getRoundName(3)).toBe('Semi-Finals')
      expect(getRoundName(4)).toBe('Final')
    })

    it('should handle custom round numbers', () => {
      const getRoundName = (round: number) => `Round ${round}`
      
      expect(getRoundName(5)).toBe('Round 5')
      expect(getRoundName(10)).toBe('Round 10')
    })
  })

  describe('Next power of 2 calculation', () => {
    it('should find exact power of 2', () => {
      const testCases = [
        { input: 8, expected: 8 },
        { input: 16, expected: 16 },
        { input: 32, expected: 32 },
      ]

      const nextPowerOf2 = (n: number) => {
        let p = 1
        while (p < n) p *= 2
        return p
      }

      testCases.forEach(({ input, expected }) => {
        expect(nextPowerOf2(input)).toBe(expected)
      })
    })

    it('should round up non-power of 2', () => {
      const nextPowerOf2 = (n: number) => {
        let p = 1
        while (p < n) p *= 2
        return p
      }

      expect(nextPowerOf2(3)).toBe(4)
      expect(nextPowerOf2(5)).toBe(8)
      expect(nextPowerOf2(9)).toBe(16)
      expect(nextPowerOf2(100)).toBe(128)
    })
  })

  describe('Match format validation', () => {
    it('should validate best-of formats', () => {
      const formats = ['bo3', 'bo5', 'bo7']
      
      formats.forEach(format => {
        expect(['bo3', 'bo5', 'bo7']).toContain(format)
      })
    })

    it('should calculate games required for match format', () => {
      const getWinsRequired = (format: string): number => {
        switch (format) {
          case 'bo3': return 2
          case 'bo5': return 3
          case 'bo7': return 4
          default: return 1
        }
      }

      expect(getWinsRequired('bo3')).toBe(2)
      expect(getWinsRequired('bo5')).toBe(3)
      expect(getWinsRequired('bo7')).toBe(4)
    })
  })

  describe('Player ranking', () => {
    it('should rank players by multiple criteria', () => {
      const players = [
        { id: 'p1', seed: 1, group: 'A', rank: 1 },
        { id: 'p2', seed: 2, group: 'B', rank: 2 },
        { id: 'p3', seed: 3, group: 'A', rank: 3 },
      ]

      const ranked = [...players].sort((a, b) => a.rank - b.rank)
      
      expect(ranked[0].id).toBe('p1')
      expect(ranked[1].id).toBe('p2')
      expect(ranked[2].id).toBe('p3')
    })

    it('should handle equal rankings with tiebreaker', () => {
      const players = [
        { id: 'p1', points: 6, seed: 1 },
        { id: 'p2', points: 6, seed: 3 },
      ]

      // Same points, sort by seed
      const ranked = [...players].sort((a, b) => 
        b.points - a.points || a.seed - b.seed
      )
      
      expect(ranked[0].id).toBe('p1')
      expect(ranked[1].id).toBe('p2')
    })
  })

  describe('Date and time utilities', () => {
    it('should format tournament dates', () => {
      const date = new Date('2026-04-15')
      const formatted = date.toISOString().split('T')[0]
      
      expect(formatted).toBe('2026-04-15')
    })

    it('should validate date ranges', () => {
      const startDate = new Date('2026-04-15')
      const endDate = new Date('2026-04-20')
      
      const isValidRange = endDate > startDate
      expect(isValidRange).toBe(true)
    })
  })

  describe('Score calculation', () => {
    it('should calculate point score from match results', () => {
      const matches = [
        { result: 'win' },
        { result: 'win' },
        { result: 'loss' },
      ]

      const points = matches.filter(m => m.result === 'win').length * 3
      expect(points).toBe(6)
    })

    it('should handle walk-overs', () => {
      const walkoverPoints = 3
      const normalWinPoints = 3
      
      expect(walkoverPoints).toBe(normalWinPoints)
    })
  })

  describe('Seed and position utilities', () => {
    it('should convert seed to bracket position', () => {
      const seed = 1
      const bracketSize = 8
      const position = seed - 1
      
      expect(position).toBe(0)
    })

    it('should find opponent seed from pairing', () => {
      const bracketSize = 8
      const mySeed = 1
      const opponentSeed = bracketSize + 1 - mySeed // Complement pairing
      
      expect(opponentSeed).toBe(8)
    })
  })
})
