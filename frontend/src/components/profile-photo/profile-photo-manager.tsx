"use client";

import Cropper, { Area } from "react-easy-crop";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import "react-easy-crop/react-easy-crop.css";

const OUTPUT_WIDTH = 945;
const OUTPUT_HEIGHT = 1181;

export type ProfilePhotoUploadPayload = {
  processedImage: File;
  originalImage?: File;
  photoEditMetadata?: Record<string, unknown>;
  photoConsentConfirmed: boolean;
};

type ProfilePhotoManagerLabels = {
  sectionTitle: string;
  sectionSubtitle: string;
  changeButton: string;
  removeButton: string;
  downloadButton: string;
  modalTitle: string;
  modalDescription: string;
  dragDropLabel: string;
  selectFileButton: string;
  cameraButton: string;
  zoomLabel: string;
  backgroundColorLabel: string;
  removeBackgroundButton: string;
  removeBackgroundBusy: string;
  consentLabel: string;
  saveButton: string;
  saveBusy: string;
  cancelButton: string;
  previewTitle: string;
  currentPhotoAlt: string;
  emptyPhotoLabel: string;
  removeBackgroundUnsupported: string;
};

type ProfilePhotoManagerProps = {
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  labels: ProfilePhotoManagerLabels;
  onSave?: (input: ProfilePhotoUploadPayload) => Promise<void>;
  onDelete?: () => Promise<void>;
  onDownload?: () => Promise<void>;
  onEdit?: () => void;
  readOnly?: boolean;
  isPageEditor?: boolean;
  onCancelEditor?: () => void;
};

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image for processing."));
    image.src = source;
  });
}

async function renderPrintReadyImage(
  imageSource: string,
  cropArea: Area,
  backgroundColor: string
): Promise<File> {
  const image = await loadImage(imageSource);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to initialize image canvas.");
  }

  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  context.drawImage(
    image,
    cropArea.x,
    cropArea.y,
    cropArea.width,
    cropArea.height,
    0,
    0,
    OUTPUT_WIDTH,
    OUTPUT_HEIGHT
  );

  const outputBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to create cropped image output."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.92
    );
  });

  return new File([outputBlob], `profile-picture-${Date.now()}.jpg`, {
    type: "image/jpeg",
  });
}

export function ProfilePhotoManager({
  imageUrl,
  thumbnailUrl,
  labels,
  onSave,
  onDelete,
  onDownload,
  onEdit,
  readOnly = false,
  isPageEditor = false,
  onCancelEditor,
}: ProfilePhotoManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [workingFile, setWorkingFile] = useState<File | null>(null);
  const [workingImageUrl, setWorkingImageUrl] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [backgroundRemoved, setBackgroundRemoved] = useState(false);

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const workingObjectUrlRef = useRef<string | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (workingObjectUrlRef.current) {
        URL.revokeObjectURL(workingObjectUrlRef.current);
      }
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    };
  }, []);

  const hasStoredPhoto = useMemo(() => Boolean(imageUrl || thumbnailUrl), [imageUrl, thumbnailUrl]);

  const setWorkingPreview = (file: File) => {
    if (workingObjectUrlRef.current) {
      URL.revokeObjectURL(workingObjectUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    workingObjectUrlRef.current = objectUrl;
    setWorkingImageUrl(objectUrl);
  };

  const setPreviewFromFile = (file: File) => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    previewObjectUrlRef.current = objectUrl;
    setPreviewImageUrl(objectUrl);
    setPreviewFile(file);
  };

  const resetEditorState = () => {
    setIsDragging(false);
    setIsSaving(false);
    setIsRemovingBackground(false);
    setConsentConfirmed(false);
    setErrorMessage(null);
    setOriginalFile(null);
    setWorkingFile(null);
    setWorkingImageUrl(null);
    setPreviewImageUrl(null);
    setPreviewFile(null);
    setBackgroundColor("#ffffff");
    setBackgroundRemoved(false);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    if (workingObjectUrlRef.current) {
      URL.revokeObjectURL(workingObjectUrlRef.current);
      workingObjectUrlRef.current = null;
    }
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  };

  const openEditor = () => {
    resetEditorState();
    setIsOpen(true);
  };

  const closeEditor = () => {
    setIsOpen(false);
    resetEditorState();
  };

  const hydrateFile = (file: File) => {
    setErrorMessage(null);
    setOriginalFile(file);
    setWorkingFile(file);
    setWorkingPreview(file);
    setBackgroundRemoved(false);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) {
      return;
    }
    hydrateFile(nextFile);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (!droppedFile) {
      return;
    }
    hydrateFile(droppedFile);
  };

  useEffect(() => {
    let isCancelled = false;

    async function regeneratePreview() {
      if (!workingImageUrl || !croppedAreaPixels) {
        return;
      }
      try {
        const generated = await renderPrintReadyImage(
          workingImageUrl,
          croppedAreaPixels,
          backgroundColor
        );
        if (!isCancelled) {
          setPreviewFromFile(generated);
        }
      } catch {
        if (!isCancelled) {
          setErrorMessage(labels.removeBackgroundUnsupported);
        }
      }
    }

    regeneratePreview();
    return () => {
      isCancelled = true;
    };
  }, [backgroundColor, croppedAreaPixels, labels.removeBackgroundUnsupported, workingImageUrl]);

  const handleRemoveBackground = async () => {
    if (!workingFile) {
      return;
    }
    setIsRemovingBackground(true);
    setErrorMessage(null);
    try {
      const bgModule = await import("@imgly/background-removal-js");
      const removedResult = await bgModule.removeBackground(workingFile);
      const removedBlob =
        removedResult instanceof Blob
          ? removedResult
          : removedResult &&
              typeof removedResult === "object" &&
              "blob" in removedResult &&
              removedResult.blob instanceof Blob
            ? removedResult.blob
            : new Blob([removedResult as ArrayBuffer], { type: "image/png" });
      const removedFile = new File([removedBlob], `bg-removed-${Date.now()}.png`, {
        type: "image/png",
      });
      setWorkingFile(removedFile);
      setWorkingPreview(removedFile);
      setBackgroundRemoved(true);
    } catch {
      setErrorMessage(labels.removeBackgroundUnsupported);
    } finally {
      setIsRemovingBackground(false);
    }
  };

  const handleSave = async () => {
    if (!workingImageUrl || !croppedAreaPixels || !originalFile) {
      setErrorMessage(labels.removeBackgroundUnsupported);
      return;
    }
    if (!onSave) {
      setErrorMessage(labels.removeBackgroundUnsupported);
      return;
    }
    if (!consentConfirmed) {
      setErrorMessage(labels.consentLabel);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      const processedOutput =
        previewFile ||
        (await renderPrintReadyImage(workingImageUrl, croppedAreaPixels, backgroundColor));
      // #region agent log
      fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "025755",
        },
        body: JSON.stringify({
          sessionId: "025755",
          runId: "initial-photo-save",
          hypothesisId: "H1",
          location: "frontend/src/components/profile-photo/profile-photo-manager.tsx:handleSave:beforeOnSave",
          message: "photo save payload prepared",
          data: {
            hasOriginalFile: Boolean(originalFile),
            hasPreviewFile: Boolean(previewFile),
            processedType: processedOutput.type,
            processedSize: processedOutput.size,
            originalType: originalFile.type,
            originalSize: originalFile.size,
            consentConfirmed,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      await onSave({
        processedImage: processedOutput,
        originalImage: originalFile,
        photoEditMetadata: {
          crop: croppedAreaPixels,
          zoom,
          output_width: OUTPUT_WIDTH,
          output_height: OUTPUT_HEIGHT,
          background_color: backgroundColor,
          background_removed: backgroundRemoved,
          aspect_ratio: "8:10",
        },
        photoConsentConfirmed: consentConfirmed,
      });
      if (isPageEditor) {
        resetEditorState();
        onCancelEditor?.();
      } else {
        closeEditor();
      }
    } catch (error) {
      // #region agent log
      fetch("http://127.0.0.1:7242/ingest/8fff0ab0-a0ae-4efd-a694-181dff4f138a", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "025755",
        },
        body: JSON.stringify({
          sessionId: "025755",
          runId: "initial-photo-save",
          hypothesisId: "H1",
          location: "frontend/src/components/profile-photo/profile-photo-manager.tsx:handleSave:catch",
          message: "photo save failed in manager",
          data: {
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setErrorMessage(
        error instanceof Error ? error.message : labels.removeBackgroundUnsupported
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) {
      return;
    }
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await onDelete();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : labels.removeBackgroundUnsupported
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    if (isPageEditor) {
      resetEditorState();
      onCancelEditor?.();
      return;
    }
    closeEditor();
  };

  const editorContent = (
    <div className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`rounded-2xl border-2 border-dashed p-5 text-sm transition ${
          isDragging
            ? "border-zinc-900 bg-zinc-100 text-zinc-800"
            : "border-zinc-300 text-zinc-600"
        }`}
      >
        <p>{labels.dragDropLabel}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => sourceInputRef.current?.click()}
          >
            {labels.selectFileButton}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => cameraInputRef.current?.click()}
          >
            {labels.cameraButton}
          </Button>
        </div>
        <input
          ref={sourceInputRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif"
          className="hidden"
          onChange={handleFileInput}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {workingImageUrl ? (
        <>
          <div className="relative h-72 overflow-hidden rounded-2xl bg-zinc-950">
            <Cropper
              image={workingImageUrl}
              crop={crop}
              zoom={zoom}
              aspect={8 / 10}
              cropShape="rect"
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, croppedPixels) => setCroppedAreaPixels(croppedPixels)}
            />
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-medium text-zinc-600">{labels.zoomLabel}</label>
            <Input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-zinc-600">
              {labels.backgroundColorLabel}
            </label>
            <Input
              type="color"
              value={backgroundColor}
              onChange={(event) => setBackgroundColor(event.target.value)}
              className="h-10 w-16 px-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isRemovingBackground}
              onClick={handleRemoveBackground}
            >
              {isRemovingBackground ? labels.removeBackgroundBusy : labels.removeBackgroundButton}
            </Button>
          </div>

          {previewImageUrl ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-600">{labels.previewTitle}</p>
              <div className="h-48 w-40 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                <img
                  src={previewImageUrl}
                  alt={labels.currentPhotoAlt}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <label className="flex items-start gap-2 text-sm text-zinc-700">
        <Checkbox
          checked={consentConfirmed}
          onCheckedChange={(checked) => setConsentConfirmed(Boolean(checked))}
        />
        <span>{labels.consentLabel}</span>
      </label>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleCancel}>
          {labels.cancelButton}
        </Button>
        <Button
          type="button"
          disabled={!workingImageUrl || !consentConfirmed || isSaving}
          onClick={handleSave}
        >
          {isSaving ? labels.saveBusy : labels.saveButton}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {isPageEditor ? (
        <section className="rounded-3xl bg-white p-6 shadow-sm">{editorContent}</section>
      ) : (
        <>
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="h-28 w-28 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
                  {thumbnailUrl || imageUrl ? (
                    <img
                      src={thumbnailUrl || imageUrl || ""}
                      alt={labels.currentPhotoAlt}
                      className="h-full w-full object-cover object-[50%_20%]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-xs text-zinc-500">
                      {labels.emptyPhotoLabel}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-zinc-900">{labels.sectionTitle}</h3>
                  <p className="text-sm text-zinc-500">{labels.sectionSubtitle}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => (onEdit ? onEdit() : openEditor())}
                  >
                    {labels.changeButton}
                  </Button>
                ) : null}
                {hasStoredPhoto && onDownload ? (
                  <Button type="button" variant="outline" size="sm" onClick={onDownload}>
                    {labels.downloadButton}
                  </Button>
                ) : null}
                {hasStoredPhoto && onDelete && !readOnly ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    {labels.removeButton}
                  </Button>
                ) : null}
              </div>
            </div>
          </section>

          <Modal
            title={labels.modalTitle}
            description={labels.modalDescription}
            isOpen={isOpen}
            onClose={closeEditor}
          >
            {editorContent}
          </Modal>
        </>
      )}
    </>
  );
}
