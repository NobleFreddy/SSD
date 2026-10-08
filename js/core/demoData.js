/**
 * ============================================================================
 * SSD.DemoData — optionale Beispieldaten für den Schnelleinstieg
 * ============================================================================
 * Wird ausschließlich auf ausdrücklichen Wunsch im Ersteinrichtungs-
 * Assistenten geladen, damit der Optimierungsalgorithmus sofort an
 * realistischen Daten ausprobiert werden kann, ohne zuerst manuell 20
 * Schüler:innen anlegen zu müssen.
 */
window.SSD = window.SSD || {};

SSD.DemoData = (function () {
  'use strict';

  const U = SSD.Utils;

  const NAMES = [
    ['Mia', 'Schneider', 'w', '9a'], ['Ben', 'Hoffmann', 'm', '9a'],
    ['Emma', 'Wagner', 'w', '9b'], ['Paul', 'Becker', 'm', '9b'],
    ['Hannah', 'Schulz', 'w', '10a'], ['Finn', 'Richter', 'm', '10a'],
    ['Lea', 'Klein', 'w', '10b'], ['Noah', 'Wolf', 'm', '10b'],
    ['Lina', 'Neumann', 'w', '10b'], ['Elias', 'Schwarz', 'm', '11'],
    ['Marie', 'Zimmermann', 'w', '11'], ['Luca', 'Braun', 'm', '11'],
    ['Sophie', 'Krüger', 'w', '11'], ['Jonas', 'Hofmann', 'm', '12'],
    ['Anna', 'Lange', 'w', '12'], ['Felix', 'Meyer', 'm', '12'],
    ['Clara', 'Vogel', 'd', '9b'], ['Tom', 'Peters', 'm', '9a'],
  ];

  const AZUBI_NAMES = [
    ['Julia', 'Berger', 'w', 'Azubi 1. Jahr'],
    ['David', 'Fuchs', 'm', 'Azubi 2. Jahr'],
    ['Nina', 'Roth', 'w', 'Azubi 1. Jahr'],
  ];

  function buildAvailability(rng) {
    const availability = SSD.Models.createEmptyAvailability();
    U.WEEKDAY_KEYS.forEach((day) => {
      U.DUTY_BLOCK_KEYS.forEach((_, blockIdx) => {
        const roll = rng();
        availability[day][blockIdx] = roll < 0.52 ? 'available' : roll < 0.92 ? 'unavailable' : 'blocked';
      });
    });
    return availability;
  }

  /** Startpasswort der Beispielkonten (muss bei der ersten Anmeldung geändert werden). */
  const PASSWORD = 'willkommen';

  async function seed() {
    const rng = U.createSeededRandom(20240915);
    const schoolYearEnd = U.schoolYearEnd();
    const entries = [];

    for (const [firstName, lastName, gender, schoolClass] of NAMES) {
      entries.push({
        firstName, lastName, gender, schoolClass, role: 'student',
        yearGroup: schoolYearEnd + (13 - (Number(schoolClass.replace(/\D/g, '')) || 10)), // Abijahrgang (G9)
        username: U.slugifyUsername(`${firstName}.${lastName}`),
        password: PASSWORD,
      });
    }
    for (const [firstName, lastName, gender, schoolClass] of AZUBI_NAMES) {
      entries.push({
        firstName, lastName, gender, schoolClass, role: 'azubi', yearGroup: null,
        username: U.slugifyUsername(`${firstName}.${lastName}`),
        password: PASSWORD,
      });
    }
    // Verfügbarkeiten gleich mit anlegen (gleiche Reihenfolge wie bisher, damit die Beispiele reproduzierbar bleiben)
    const availabilities = entries.map(() => buildAvailability(rng));
    const { students } = await SSD.StudentService.createMany(entries);

    SSD.Store.commit('Beispieldaten ergänzt', (draft) => {
      students.forEach((student, i) => {
        const target = draft.students.find((s) => s.id === student.id);
        if (target) target.availability = availabilities[i];
      });
      const nextMonth = U.addDays(U.today(), 28);
      draft.specialDays.push(SSD.Models.createSpecialDay({
        type: 'ferien', label: 'Herbstferien',
        startDate: U.toIsoDate(nextMonth), endDate: U.toIsoDate(U.addDays(nextMonth, 9)),
      }));
      const examDay = U.addDays(U.today(), 9);
      draft.specialDays.push(SSD.Models.createSpecialDay({
        type: 'klausurtag', label: 'Zentrale Klausuren Jgst. 11/12',
        startDate: U.toIsoDate(examDay), endDate: U.toIsoDate(examDay),
      }));
    }, { trackHistory: false });

    await SSD.Store.forceSave();
  }

  return { seed, PASSWORD };
})();
