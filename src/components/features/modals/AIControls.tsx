import { Dropdown } from "@/components/nextui/Dropdown";
import { Button } from "@/components/nextui/Button";
import { DropdownTrigger, DropdownMenu, DropdownItem } from "@nextui-org/react";
import { BiChevronDown } from "react-icons/bi";
import { ReactNode } from "react";

type ControlAction = "markdown" | "html" | "plaintext";
type ControlType = "copy" | "download";

interface Control {
  label: string;
  icon: ReactNode;
  action: ControlAction;
}

interface AIControlsProps {
  controls: Control[];
  content: string;
  type: ControlType;
  buttonLabel: string;
  buttonIcon: ReactNode;
  contentRef: React.RefObject<HTMLDivElement>;
}

export function AIControls({ controls, content, type, buttonLabel, buttonIcon, contentRef }: AIControlsProps) {
  const handleAction = async (action: ControlAction) => {
    const getContent = (action: ControlAction): string => {
      switch (action) {
        case 'markdown': {
          let transformed = content.replace(
            /\[QUOTE\s*(.*?)\s*QUOTE\/\]/g,
            '\n> $1'
          );
          transformed = transformed.replace(
            /\[PAGE\s*(.*?)\s*PAGE\/\]/g,
            '(p.$1)'
          );
          transformed = transformed.replace(
            /\[SECTION\s*(.*?)\s*SECTION\/\]/g,
            '(s.$1)'
          );
          return transformed;
        }
        case 'html': {
          const html = contentRef.current?.innerHTML || '';
          return html
            .replace(/^<div[^>]*>([\s\S]*)<\/div>$/, '$1')
            .replace(/<([a-zA-Z0-9]+)[^>]*>/g, '<$1>');
        }
        case 'plaintext':
          return contentRef.current?.textContent || '';
        default:
          return content;
      }
    };

    const getFileExtension = (action: ControlAction): string => {
      switch (action) {
        case 'markdown':
          return 'md';
        case 'html':
          return 'html';
        case 'plaintext':
          return 'txt';
        default:
          return 'txt';
      }
    };

    const processedContent = getContent(action);

    if (type === "copy") {
      await navigator.clipboard.writeText(processedContent);
    } else {
      const blob = new Blob([processedContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${buttonLabel}_${new Date().toISOString()}.${getFileExtension(action)}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Dropdown>
      <DropdownTrigger>
        <Button
          size="sm"
          startContent={buttonIcon}
          endContent={<BiChevronDown />}
        >
          {buttonLabel}
        </Button>
      </DropdownTrigger>
      <DropdownMenu>
        {controls.map((control, index) => (
          <DropdownItem
            key={index}
            startContent={control.icon}
            onPress={() => handleAction(control.action)}
          >
            {control.label}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
} 