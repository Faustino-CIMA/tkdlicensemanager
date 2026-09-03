"use client";

import Cropper, { Area } from "react-easy-crop";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionNotices } from "@/components/ui/list-page-chrome";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { API_URL } from "@/lib/api";
import { getToken } from "@/lib/auth";
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
  cameraCaptureButton?: string;
  cameraCancelButton?: string;
  cameraStarting?: string;
  cameraUnavailable?: string;
  cameraPermissionDenied?: string;
  cameraStartError?: string;
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

function resolveImageRequestUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl, API_URL).toString();
  } catch {
    return rawUrl;
  }
}

async function fetchAuthenticatedImageBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
  const token = getToken();
  const response = await fetch(resolveImageRequestUrl(url), {
    method: "GET",
    signal,
    headers: token ? { Authorization: `Token ${token}` } : undefined,
  });
  if (!response.ok) {
    return null;
  }
  return response.blob();
}

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
  const [storedPhotoPreviewUrl, setStoredPhotoPreviewUrl] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [backgroundRemoved, setBackgroundRemoved] = useState(false);

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);

  const handleCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
    setIsStartingCamera(false);
  }, []);

  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const workingObjectUrlRef = useRef<string | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const storedPhotoObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      if (workingObjectUrlRef.current) {
        URL.revokeObjectURL(workingObjectUrlRef.current);
      }
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
      if (storedPhotoObjectUrlRef.current) {
        URL.revokeObjectURL(storedPhotoObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isCameraOpen || !videoRef.current || !cameraStreamRef.current) {
      return;
    }
    videoRef.current.srcObject = cameraStreamRef.current;
    void videoRef.current.play().catch(() => {
      setErrorMessage(labels.cameraStartError ?? "Unable to start the camera.");
    });
  }, [isCameraOpen, labels.cameraStartError]);

  useEffect(() => {
    const sources = [thumbnailUrl, imageUrl]
      .map((value) => (value ?? "").trim())
      .filter((value) => value.length > 0);

    if (sources.length === 0) {
      if (storedPhotoObjectUrlRef.current) {
        URL.revokeObjectURL(storedPhotoObjectUrlRef.current);
        storedPhotoObjectUrlRef.current = null;
      }
      setStoredPhotoPreviewUrl(null);
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;

    if (storedPhotoObjectUrlRef.current) {
      URL.revokeObjectURL(storedPhotoObjectUrlRef.current);
      storedPhotoObjectUrlRef.current = null;
    }
    setStoredPhotoPreviewUrl(null);

    const loadStoredPhoto = async () => {
      for (const source of sources) {
        try {
          const blob = await fetchAuthenticatedImageBlob(source, controller.signal);
          if (!blob) {
            continue;
          }
          const objectUrl = URL.createObjectURL(blob);
          if (isCancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          if (storedPhotoObjectUrlRef.current) {
            URL.revokeObjectURL(storedPhotoObjectUrlRef.current);
          }
          storedPhotoObjectUrlRef.current = objectUrl;
          setStoredPhotoPreviewUrl(objectUrl);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }
      }

      if (isCancelled) {
        return;
      }
      if (storedPhotoObjectUrlRef.current) {
        URL.revokeObjectURL(storedPhotoObjectUrlRef.current);
        storedPhotoObjectUrlRef.current = null;
      }
      setStoredPhotoPreviewUrl(null);
    };

    void loadStoredPhoto();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [imageUrl, thumbnailUrl]);

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
    stopCamera();
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

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click();
      return;
    }

    setIsStartingCamera(true);
    setErrorMessage(null);
    try {
      const constraintAttempts: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: "user" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        { video: { facingMode: { ideal: "environment" } } },
        { video: true },
      ];

      let stream: MediaStream | null = null;
      let lastError: unknown;
      for (const constraints of constraintAttempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!stream) {
        throw lastError ?? new Error("Unable to start the camera.");
      }

      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = stream;
      setIsCameraOpen(true);
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      setErrorMessage(
        denied
          ? (labels.cameraPermissionDenied ??
            "Camera access was blocked. Allow camera permission in the browser and try again.")
          : (labels.cameraStartError ?? "Unable to start the camera.")
      );
    } finally {
      setIsStartingCamera(false);
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setErrorMessage(labels.cameraStartError ?? "Unable to start the camera.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setErrorMessage(labels.cameraStartError ?? "Unable to start the camera.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErrorMessage(labels.cameraStartError ?? "Unable to start the camera.");
          return;
        }
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        hydrateFile(file);
        stopCamera();
      },
      "image/jpeg",
      0.92
    );
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
        className={`rounded-[var(--radius-card)] border-2 border-dashed p-5 text-sm transition ${
          isDragging
            ? "border-foreground bg-secondary text-foreground"
            : "border-border text-muted"
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
            disabled={isStartingCamera}
            onClick={() => {
              void startCamera();
            }}
          >
            {isStartingCamera
              ? (labels.cameraStarting ?? "Starting camera...")
              : labels.cameraButton}
          </Button>
        </div>
        {isCameraOpen ? (
          <div className="mt-4 space-y-3">
            <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-[#0a0a0a]">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="mx-auto max-h-72 w-full bg-black object-contain"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={capturePhoto}>
                {labels.cameraCaptureButton ?? "Take photo"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={stopCamera}>
                {labels.cameraCancelButton ?? "Cancel camera"}
              </Button>
            </div>
          </div>
        ) : null}
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
          capture="user"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {workingImageUrl ? (
        <>
          {/* Dark canvas is intentional for image cropping contrast */}
          <div className="relative h-72 overflow-hidden rounded-[var(--radius-card)] bg-[#0a0a0a]">
            <Cropper
              image={workingImageUrl}
              crop={crop}
              zoom={zoom}
              aspect={8 / 10}
              cropShape="rect"
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-medium text-muted">{labels.zoomLabel}</label>
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
            <label className="text-xs font-medium text-muted">
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
              <p className="text-xs font-medium text-muted">{labels.previewTitle}</p>
              <div className="h-48 w-40 overflow-hidden rounded-[var(--radius-card)] border border-border bg-secondary">
                {/* eslint-disable-next-line @next/next/no-img-element -- crop preview uses blob URL */}
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

      <label className="flex items-start gap-2 text-sm text-foreground">
        <Checkbox
          checked={consentConfirmed}
          onCheckedChange={(checked) => setConsentConfirmed(Boolean(checked))}
        />
        <span>{labels.consentLabel}</span>
      </label>

      <ActionNotices error={errorMessage} onDismiss={() => setErrorMessage(null)} />

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
        <section className="rounded-[var(--radius-card)] bg-card p-6 shadow-sm">{editorContent}</section>
      ) : (
        <>
          <section className="rounded-[var(--radius-card)] bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="aspect-[8/10] w-28 overflow-hidden rounded-[var(--radius-card)] border border-border bg-secondary">
                  {storedPhotoPreviewUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- stored photo can be blob or API URL */
                    <img
                      src={storedPhotoPreviewUrl}
                      alt={labels.currentPhotoAlt}
                      className="h-full w-full object-cover object-[50%_20%]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted">
                      {labels.emptyPhotoLabel}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-foreground">{labels.sectionTitle}</h3>
                  <p className="text-sm text-muted">{labels.sectionSubtitle}</p>
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
