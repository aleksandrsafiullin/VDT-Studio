"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject
} from "react";
import { createPortal } from "react-dom";
import { Settings, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisplaySettings } from "./display-settings";
import { ExecutionModeSettings } from "./execution-mode-settings";
import { SpeechSettings } from "./speech-settings";
import styles from "./settings-modal.module.css";
import {
  SETTINGS_SECTION_META,
  SettingsNav,
  type SettingsSectionId
} from "./settings-nav";

const TRIGGER_ID = "settings-modal-trigger";
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(event: KeyboardEvent, container: HTMLElement) {
  if (event.key !== "Tab") {
    return;
  }

  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  );

  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement as HTMLElement | null;

  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

interface SettingsModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialSection?: SettingsSectionId;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  hideTrigger?: boolean;
  confirmSpeechDownload?: boolean;
}

export function SettingsModal({
  open: controlledOpen,
  onOpenChange,
  initialSection = "execution",
  triggerRef: externalTriggerRef,
  hideTrigger = false,
  confirmSpeechDownload = false
}: SettingsModalProps = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  const open = controlledOpen ?? uncontrolledOpen;
  const sectionMeta = SETTINGS_SECTION_META[activeSection];

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange]
  );

  const closeModal = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      (externalTriggerRef?.current ?? document.getElementById(TRIGGER_ID))?.focus();
    });
  }, [setOpen, externalTriggerRef]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveSection(initialSection);
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }

      if (dialogRef.current) {
        trapFocus(event, dialogRef.current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, closeModal]);

  const modalContent =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className={styles.overlay}>
            <div
              className={styles.backdrop}
              aria-hidden="true"
              data-testid="settings-modal-backdrop"
              onClick={closeModal}
            />
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Workspace settings"
              aria-labelledby={titleId}
              aria-describedby={subtitleId}
              data-testid="settings-modal"
              className={styles.dialog}
            >
              <div className={styles.layout}>
                <aside className={styles.sidebar}>
                  <div className={styles.identity}>
                    <span className={styles.settingsMark}>
                      <Settings className="h-4 w-4" aria-hidden />
                    </span>
                    <div>
                      <p className={styles.identityTitle}>Settings</p>
                      <p className={styles.identitySubtitle}>VDT Studio</p>
                    </div>
                  </div>
                  <SettingsNav
                    activeSection={activeSection}
                    onSelect={setActiveSection}
                    layout="responsive"
                  />
                </aside>

                <div className={styles.main}>
                  <header className={styles.header}>
                    <div>
                      <h2 id={titleId} className={styles.title}>
                        {sectionMeta.title}
                      </h2>
                      <p id={subtitleId} className={styles.subtitle}>
                        {sectionMeta.subtitle}
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Close settings"
                      data-testid="settings-modal-close"
                      className={styles.closeButton}
                      icon={<X className="h-4 w-4" />}
                      onClick={closeModal}
                    />
                  </header>

                  <div className={styles.content}>
                    {activeSection === "execution" ? <ExecutionModeSettings /> : null}
                    {activeSection === "voice" ? <SpeechSettings confirmOnOpen={confirmSpeechDownload} /> : null}
                    {activeSection === "display" ? <DisplaySettings /> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {hideTrigger ? null : (
        <Button
          id={TRIGGER_ID}
          size="icon"
          variant="ghost"
          aria-label="Settings"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="settings-button"
          icon={<Settings className="h-4 w-4" />}
          onClick={() => setOpen(!open)}
        />
      )}
      {modalContent}
    </>
  );
}

/** @deprecated Use SettingsModal */
export function SettingsPopover() {
  return <SettingsModal />;
}
