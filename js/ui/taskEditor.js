/**
 * ============================================================================
 * SSD.TaskEditor — Dialog "Aufgabe anlegen/bearbeiten"
 * ============================================================================
 * Gemeinsamer Dialog für den Administrator (Ansicht "Aufgaben") und die
 * Sanisprecher:innen (Reiter "Aufgaben" im Dashboard). Wer eine Aufgabe
 * anlegt, merkt sich `SSD.TasksService.create` automatisch.
 */
window.SSD = window.SSD || {};

SSD.TaskEditor = (function () {
  'use strict';

  const U = SSD.Utils;

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  /**
   * @param {object|null} existing - zu bearbeitende Aufgabe oder `null` für eine neue
   * @param {{ onSaved?: Function }} [opts]
   */
  function open(existing, opts) {
    const isEdit = !!existing;
    const titleInput = U.el('input', { class: 'input', value: existing?.title || '', placeholder: 'z. B. Verbandskästen kontrollieren' });
    const descInput = U.el('textarea', { class: 'input', rows: '3', placeholder: 'Details, Ort, Hinweise, …' }, [existing?.description || '']);
    const dueInput = U.el('input', { class: 'input', type: 'date', value: existing?.dueDate || '' });
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      field('Titel', titleInput),
      field('Beschreibung (optional)', descInput, U.FREE_TEXT_HINT),
      field('Fällig bis (optional)', dueInput),
    ]);

    const footerButtons = [
      { label: 'Abbrechen', variant: 'secondary' },
      {
        label: isEdit ? 'Speichern' : 'Anlegen', variant: 'primary', closeOnClick: false,
        onClick: () => {
          errorBox.style.display = 'none';
          if (!titleInput.value.trim()) { errorBox.textContent = 'Bitte einen Titel angeben.'; errorBox.style.display = 'flex'; return; }
          const data = {
            title: titleInput.value.trim(),
            description: descInput.value.trim(),
            dueDate: dueInput.value || null,
          };
          try {
            if (isEdit) SSD.TasksService.update(existing.id, data);
            else SSD.TasksService.create(data);
          } catch (err) {
            errorBox.textContent = String(err.message || err);
            errorBox.style.display = 'flex';
            return;
          }
          SSD.Toast.success('Gespeichert', isEdit ? 'Aufgabe aktualisiert.' : 'Die Aufgabe ist jetzt für alle Sanis und Azubis sichtbar.');
          handle.close();
          if (opts && opts.onSaved) opts.onSaved();
        },
      },
    ];

    const handle = SSD.Dialog.open({ title: isEdit ? 'Aufgabe bearbeiten' : 'Aufgabe anlegen', body, wide: true, footerButtons });
  }

  /** "Administration" bzw. Name der Sanisprecher:in, die die Aufgabe angelegt hat. */
  function creatorLabel(task) {
    if (!task.createdBy) return 'Administration';
    const person = SSD.StudentService.getById(task.createdBy);
    return person ? SSD.StudentService.fullName(person) : '(gelöscht)';
  }

  return { open, creatorLabel };
})();
