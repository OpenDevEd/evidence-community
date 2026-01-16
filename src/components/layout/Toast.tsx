'use client';

import React from 'react';
import { toast as sonnerToast } from 'sonner';

/** I recommend abstracting the toast function
 *  so that you can call it without having to use toast.custom everytime. */
export function toast(toast: Omit<ToastProps, 'id'>) {
  return sonnerToast.custom((id) => (
    <Toast
      id={id}
      title={toast.title}
      description={toast.description}
      type={toast.type}
      button={toast.button ? {
        label: toast.button.label,
        onClick: toast.button.onClick,
      } : undefined}
    />
  ), {
    position: "bottom-left"
  });
}

/** A fully custom toast that still maintains the animations and interactions. */
function Toast(props: ToastProps) {
  const { title, description, button, id, type } = props;

  return (
    <div data-type={type} className={`flex rounded-lg bg-background_light dark:bg-secondary data-[type=error]:!bg-red-500 text-black dark:text-white shadow-lg ring-1 ring-black/5 w-96  items-center p-4`}>
      <div className="flex flex-1 items-center">
        <div className="w-full">
          <p className="text-sm font-medium ">{title}</p>
          {description && <p className="mt-1 text-sm opacity-80 whitespace-pre-wrap">{description}</p>}
        </div>
      </div>
      {button && (
      <div className="ml-5 shrink-0 rounded-md text-sm font-medium focus:ring-2  focus:ring-offset-2 focus:outline-hidden">
        <button
          className="rounded bg-indigo-50 px-3 py-1 text-sm font-semibold  hover:bg-indigo-100"
          onClick={() => {
            button.onClick();
            sonnerToast.dismiss(id);
          }}
        >
          {button.label}
        </button>
      </div>
      )}
    </div>
  );
}

export default function Headless() {
  return (
    <button
      className="relative flex h-10 flex-shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full bg-white px-4 text-sm font-medium shadow-sm transition-all hover:bg-[#FAFAFA] dark:bg-[#161615] dark:hover:bg-[#1A1A19] dark:text-white"
      onClick={() => {
        toast({
          title: 'This is a headless toast',
          description: 'You have full control of styles and jsx, while still having the animations.',
          button: {
            label: 'Reply',
            onClick: () => sonnerToast.dismiss(),
          },
        });
      }}
    >
      Render toast
    </button>
  );
}

interface ToastProps {
  id: string | number;
  title: string;
  description?: string;
  type?: "success" | "error";
  button?: {
    label: string;
    onClick: () => void;
  };
}