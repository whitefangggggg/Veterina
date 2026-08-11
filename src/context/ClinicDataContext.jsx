/* oxlint-disable react/only-export-components */
import { createContext, useContext, useState } from 'react'
import {
  demoAppointments,
  demoInventory,
  demoOwners,
  demoPets,
  demoReminders,
  demoSuppliers,
  demoVaccinations,
  demoVisits,
} from '../data/demoData'

const ClinicDataContext = createContext(null)

const clone = (value) => JSON.parse(JSON.stringify(value))

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function ClinicDataProvider({ children }) {
  const [owners, setOwners] = useState(() => clone(demoOwners))
  const [pets, setPets] = useState(() => clone(demoPets))
  const [visits, setVisits] = useState(() => clone(demoVisits))
  const [vaccinations, setVaccinations] = useState(() => clone(demoVaccinations))
  const [appointments, setAppointments] = useState(() => clone(demoAppointments))
  const [reminders, setReminders] = useState(() => clone(demoReminders))
  const [inventory, setInventory] = useState(() => clone(demoInventory))
  const [suppliers] = useState(() => clone(demoSuppliers))

  const addOwner = (owner) => {
    const next = { ...owner, id: makeId('owner'), pets: [] }
    setOwners((current) => [next, ...current])
    return next
  }

  const addPet = (pet) => {
    const next = {
      ...pet,
      id: makeId('pet'),
      recordNumber: `VET-${new Date().getFullYear()}-${String(pets.length + 32).padStart(4, '0')}`,
      allergies: pet.allergies ? [pet.allergies] : [],
      alerts: [],
      status: 'Active',
      latestWeight: Number(pet.latestWeight) || null,
      photoColor: '#7aa899',
    }
    setPets((current) => [next, ...current])
    setOwners((current) => current.map((owner) => (
      owner.id === next.ownerId ? { ...owner, pets: [...owner.pets, next.id] } : owner
    )))
    return next
  }

  const addVisit = (visit) => {
    const next = {
      ...visit,
      id: makeId('visit'),
      visitedAt: new Date().toISOString(),
      weightKg: Number(visit.weightKg),
      temperatureC: Number(visit.temperatureC) || null,
      heartRate: Number(visit.heartRate) || null,
      respiratoryRate: Number(visit.respiratoryRate) || null,
      bodyConditionScore: Number(visit.bodyConditionScore) || null,
    }
    setVisits((current) => [next, ...current])
    if (next.weightKg) {
      setPets((current) => current.map((pet) => (
        pet.id === next.petId ? { ...pet, latestWeight: next.weightKg } : pet
      )))
    }
    if (next.followUpDate) {
      setReminders((current) => [{
        id: makeId('rem'),
        petId: next.petId,
        type: 'Follow-up',
        title: `${next.type} follow-up`,
        dueDate: next.followUpDate,
        priority: 'Normal',
        status: 'Upcoming',
        assignedTo: 'Clinical staff',
        notes: next.plan || 'Follow up after clinical visit.',
      }, ...current])
    }
    return next
  }

  const addVaccination = (vaccination) => {
    const next = { ...vaccination, id: makeId('vac') }
    setVaccinations((current) => [next, ...current])
    if (next.nextDueAt) {
      setReminders((current) => [{
        id: makeId('rem'),
        petId: next.petId,
        type: 'Vaccination',
        title: `${next.vaccine} due`,
        dueDate: next.nextDueAt,
        priority: 'Normal',
        status: 'Upcoming',
        assignedTo: 'Clinical staff',
        notes: `Contact owner to schedule the next ${next.vaccine} dose.`,
      }, ...current])
    }
    return next
  }

  const addAppointment = (appointment) => {
    const next = { ...appointment, id: makeId('apt'), status: 'Confirmed' }
    setAppointments((current) => [...current, next].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)))
    return next
  }

  const completeReminder = (id, outcome = 'Contact completed') => {
    setReminders((current) => current.map((reminder) => (
      reminder.id === id
        ? { ...reminder, status: 'Completed', completedAt: new Date().toISOString(), outcome }
        : reminder
    )))
  }

  const adjustStock = (id, delta, reason) => {
    setInventory((current) => current.map((item) => (
      item.id === id
        ? {
            ...item,
            quantity: Math.max(0, item.quantity + Number(delta)),
            lastMovement: { delta: Number(delta), reason, at: new Date().toISOString() },
          }
        : item
    )))
  }

  const getOwner = (id) => owners.find((owner) => owner.id === id)
  const getPet = (id) => pets.find((pet) => pet.id === id)

  const value = {
    owners,
    pets,
    visits,
    vaccinations,
    appointments,
    reminders,
    inventory,
    suppliers,
    addOwner,
    addPet,
    addVisit,
    addVaccination,
    addAppointment,
    completeReminder,
    adjustStock,
    getOwner,
    getPet,
  }

  return <ClinicDataContext.Provider value={value}>{children}</ClinicDataContext.Provider>
}

export function useClinicData() {
  const context = useContext(ClinicDataContext)
  if (!context) throw new Error('useClinicData must be used inside ClinicDataProvider')
  return context
}
