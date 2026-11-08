/**
 * 宿主浏览器 UI 组件库的最小类型声明。
 *
 * 该包是 baseline external（tsdown.client.config.ts 的 BASELINE_EXTERNALS），
 * 运行时由宿主 ModuleLoader 注入，本仓库不安装。这里只声明本插件用到的导出，
 * 签名对齐 deepseek-harness packages/client/ui-primitives/src 的同名组件；
 * 新增使用前须先在此补声明，并与宿主源码核对。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type {
    ButtonHTMLAttributes,
    ForwardRefExoticComponent,
    InputHTMLAttributes,
    KeyboardEventHandler,
    NamedExoticComponent,
    ReactElement,
    ReactNode,
    RefAttributes,
  } from 'react';

  export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar';

  export type ButtonProps = {
    variant?: ButtonVariant;
    size?: 'md' | 'sm';
    icon?: ReactNode;
    className?: string | undefined;
    children?: ReactNode;
  } & ButtonHTMLAttributes<HTMLButtonElement>;

  export const Button: ForwardRefExoticComponent<ButtonProps & RefAttributes<HTMLButtonElement>>;

  export type InputProps = {
    icon?: ReactNode;
    className?: string;
  } & InputHTMLAttributes<HTMLInputElement>;

  export const Input: ForwardRefExoticComponent<InputProps & RefAttributes<HTMLInputElement>>;

  export interface ModalBaseProps {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children?: ReactNode;
    footer?: ReactNode;
    className?: string;
    contentClassName?: string;
    shortcutModal?: string;
    onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
    backdropBlur?: boolean;
  }

  /** 非 headless 弹窗必须提供本地化的关闭按钮无障碍标签。 */
  export type ModalProps = ModalBaseProps & (
    | { headless: true; closeLabel?: never }
    | { headless?: false; closeLabel: string }
  );

  export function Modal(props: ModalProps): ReactElement | null;

  export interface SwitchProps {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    disabled?: boolean;
    title?: string | undefined;
    className?: string | undefined;
  }

  export function Switch(props: SwitchProps): ReactElement;

  export interface SegmentedControlOption<Value extends string> {
    value: Value;
    label: string;
    disabled?: boolean;
    title?: string;
  }

  export interface SegmentedControlProps<Value extends string> {
    id: string;
    value: Value;
    options: readonly SegmentedControlOption<Value>[];
    onChange: (next: Value) => void;
    label: string;
    disabled?: boolean;
    className?: string | undefined;
  }

  export function SegmentedControl<Value extends string>(props: SegmentedControlProps<Value>): ReactElement;

  export interface DisclosureRowProps {
    icon: ReactNode;
    title: string;
    open: boolean;
    expandable: boolean;
    onToggle: () => void;
    running?: boolean | undefined;
    expandOnRowClick?: boolean | undefined;
    previewChevron?: boolean | undefined;
    keepContentWhenOpen?: boolean | undefined;
    collapsedContent?: ReactNode;
    headerAccessory?: ReactNode;
    children?: ReactNode;
    className?: string | undefined;
    rowClassName?: string | undefined;
    contentClassName?: string | undefined;
    contentLayoutClassName?: string | undefined;
    leadingClassName?: string | undefined;
    chevronClassName?: string | undefined;
    titleClassName?: string | undefined;
  }

  export const DisclosureRow: NamedExoticComponent<DisclosureRowProps>;

  export interface IconProps {
    size?: number | undefined;
    className?: string | undefined;
  }

  type Icon = (props: IconProps) => ReactElement;
  export const IconCheckOutlineRegular: Icon;
  export const IconChevronDownOutlineRegular: Icon;
  export const IconCopyOutlineRegular: Icon;
  export const IconDownloadOutlineRegular: Icon;
  export const IconPlusOutlineRegular: Icon;
}
