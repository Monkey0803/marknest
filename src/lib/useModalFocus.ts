import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** 可由 Tab 聚焦的元素选择器 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 当前挂载的模态弹窗栈。多个弹窗可叠加（如书签弹窗里再新建分组），
 * 只有栈顶弹窗响应 Tab 陷阱，避免两个监听器互相抢夺焦点。
 */
const modalStack: HTMLElement[] = [];

/**
 * 为 aria-modal 弹窗补齐四件事：
 * 1. 打开后确保焦点落在弹窗内（尊重 autoFocus / 组件自身的聚焦逻辑）；
 * 2. Tab / Shift+Tab 在弹窗内循环，不会跑到背后的界面；
 * 3. Esc 关闭——只有栈顶弹窗响应，且阻止事件继续冒泡到主界面的全局快捷键；
 * 4. 关闭后把焦点还给打开它的那个元素。
 *
 * 必须在组件的 `if (!open) return null` 之前调用（保持 hooks 调用顺序稳定）。
 */
export function useModalFocus(
  active: boolean,
  containerRef: RefObject<HTMLElement>,
  onEscape?: () => void,
): void {
  const returnFocus = useRef<HTMLElement | null>(null);
  // 用 ref 持有回调，避免调用方传入内联函数时导致 effect 反复重绑
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container || modalStack.includes(container)) return;

    // 每个弹窗各自记录打开前的焦点，关闭后各归各位
    returnFocus.current = document.activeElement as HTMLElement | null;
    modalStack.push(container);

    // 子组件的 autoFocus / setTimeout 聚焦先执行；下一帧再兜底检查焦点是否已在弹窗内
    const raf = requestAnimationFrame(() => {
      if (modalStack[modalStack.length - 1] !== container) return;
      if (!container.contains(document.activeElement)) {
        const first = container.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? container).focus();
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== container) return;
      // Esc：仅栈顶弹窗关闭，并阻断冒泡，避免同时触发主界面的「清除筛选」等快捷键
      if (e.key === 'Escape' && onEscapeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        // 排除隐藏元素（hover 才显示的操作栏、visibility:hidden / display:none）
        .filter((el) => {
          if (el === document.activeElement) return true;
          if (el.getClientRects().length === 0) return false;
          const style = getComputedStyle(el);
          return style.visibility !== 'hidden' && style.display !== 'none';
        });
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey) {
        if (current === first || !container.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !container.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      const i = modalStack.indexOf(container);
      if (i >= 0) modalStack.splice(i, 1);
      const prev = returnFocus.current;
      if (prev && document.contains(prev)) {
        requestAnimationFrame(() => prev.focus());
      }
    };
  }, [active, containerRef]);
}
