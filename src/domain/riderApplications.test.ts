import { describe, expect, it } from 'vitest'
import { RIDER_QUIZ, newRiderLimitError, quizMistakes, quizPassed, riderAccountBlocker, validateRiderApplication, type RiderApplicationInput } from './riderApplications'

const answers = RIDER_QUIZ.map((q) => q.answer)
const good: RiderApplicationInput = {
  fullName: 'Bayo Adeyemi', nin: '12345678901', phone: '0803 123 4567', address: '12 Allen Avenue, Ikeja', area: 'ikeja', vehicle: 'motorcycle', plate: 'LND 123 AB',
  guarantorName: 'Kemi Adeyemi', guarantorPhone: '0805 765 4321', guarantorRelationship: 'Sister', idPhoto: 'data:x', selfiePhoto: 'data:y', quizAnswers: answers,
}

describe('rider applications', () => {
  it('needs every check, and the quiz passed', () => {
    expect(validateRiderApplication(good)).toEqual([])
    expect(validateRiderApplication({ ...good, nin: '1234' })).toEqual(['nin_invalid'])
    expect(validateRiderApplication({ ...good, plate: '' })).toEqual(['plate_required'])
    expect(validateRiderApplication({ ...good, vehicle: 'bicycle', plate: '' })).toEqual([])
    expect(validateRiderApplication({ ...good, guarantorPhone: '+234 803 123 4567' })).toEqual(['guarantor_same_phone'])
    expect(validateRiderApplication({ ...good, area: 'mars', fullName: 'Bayo', selfiePhoto: '' })).toEqual(['name_required', 'area_required', 'selfie_required'])
    expect(validateRiderApplication({ ...good, quizAnswers: [] })).toEqual(['quiz_failed'])
  })

  it('marks the quiz', () => {
    expect(quizPassed(answers)).toBe(true)
    const wrong = [...answers]
    wrong[2] = (wrong[2] + 1) % 3
    expect(quizPassed(wrong)).toBe(false)
    expect(quizMistakes(wrong)).toEqual([2])
    expect(quizMistakes([])).toHaveLength(RIDER_QUIZ.length)
  })

  it('only takes accounts that haven’t bought or sold', () => {
    const fresh = { isBuyer: true, sellsAsIndividual: false, hasBought: false, appliedAsStore: false }
    expect(riderAccountBlocker(fresh)).toBeNull()
    expect(riderAccountBlocker({ ...fresh, hasBought: true })).toMatch(/already bought/)
    expect(riderAccountBlocker({ ...fresh, appliedAsStore: true })).toMatch(/sells/)
    expect(riderAccountBlocker({ ...fresh, isBuyer: false })).toMatch(/new account/)
  })

  it('keeps new riders to smaller jobs until they’ve done 20', () => {
    const base = { completed: 0, trusted: false, orderKobo: 20_000_00, isPrize: false }
    expect(newRiderLimitError(base)).toBeNull()
    expect(newRiderLimitError({ ...base, orderKobo: 50_000_01 })).toMatch(/20 completed/)
    expect(newRiderLimitError({ ...base, isPrize: true })).toMatch(/Won items/)
    expect(newRiderLimitError({ ...base, isPrize: true, completed: 20 })).toBeNull()
    expect(newRiderLimitError({ ...base, orderKobo: 900_000_00, trusted: true })).toBeNull()
  })
})
