/**
 * LCD Display Manager
 *
 * Manages a 20x4 I2C LCD display for showing PipeliNostr status.
 * Uses i2cset commands directly for hardware communication.
 *
 * Wiring (Raspberry Pi):
 *   VCC -> 5V (pin 4)
 *   GND -> GND (pin 6)
 *   SDA -> GPIO 2 (pin 3)
 *   SCL -> GPIO 3 (pin 5)
 *
 * Default I2C address: 0x27 (some modules use 0x3F)
 *
 * Prerequisites:
 *   sudo apt install i2c-tools
 *   Enable I2C: sudo raspi-config -> Interface Options -> I2C
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../persistence/logger.js';
import { nip19 } from 'nostr-tools';

const execAsync = promisify(exec);

// LCD dimensions
const LCD_COLS = 20;
const LCD_ROWS = 4;

// I2C LCD commands (HD44780 via PCF8574 - Standard pinout)
// P0 = RS, P1 = RW, P2 = E, P3 = Backlight, P4-P7 = D4-D7
const LCD_BACKLIGHT = 0x08;  // P3
const LCD_ENABLE = 0x04;     // P2
const LCD_RW = 0x02;         // P1 (always 0 for write)
const LCD_RS = 0x01;         // P0
const LCD_COMMAND = 0x00;    // RS=0
const LCD_DATA = 0x01;       // RS=1 (P0)

// LCD initialization commands
const LCD_CLEAR = 0x01;
const LCD_HOME = 0x02;
const LCD_ENTRY_MODE = 0x06;
const LCD_DISPLAY_ON = 0x0C;
const LCD_FUNCTION_SET = 0x28; // 4-bit, 2 lines, 5x8 font

// Row addresses for 20x4 LCD
const LCD_ROW_OFFSETS = [0x00, 0x40, 0x14, 0x54];

export interface LcdConfig {
  enabled: boolean;
  i2c_bus?: number;
  i2c_address?: number;
  npub_names?: Record<string, string>;
}

// Profile metadata from kind 0 events
interface NostrProfile {
  name?: string;
  display_name?: string;
  nip05?: string;
}

class LcdDisplayManager {
  private config: LcdConfig = { enabled: false };
  private i2cBus: number = 1;
  private i2cAddress: number = 0x27;
  private connected: boolean = false;
  private currentLines: string[] = ['', '', '', ''];
  private idleTimeout: NodeJS.Timeout | null = null;
  private workflowActive: boolean = false;
  private backlight: boolean = true;

  // Mutex for I2C operations - prevents concurrent writes
  private writeLock: Promise<void> = Promise.resolve();

  // Profile name cache (npub -> display name)
  private profileCache: Map<string, string> = new Map();
  private profileFetchPromises: Map<string, Promise<string | null>> = new Map();
  private relayUrls: string[] = [];

  async initialize(config: LcdConfig): Promise<void> {
    this.config = config;

    if (!config.enabled) {
      logger.info('[LCD] Display disabled in config');
      return;
    }

    this.i2cBus = config.i2c_bus ?? 1;
    this.i2cAddress = config.i2c_address ?? 0x27;

    try {
      // Test I2C connection
      await this.testConnection();

      // Initialize LCD
      await this.initLcd();

      // Wait for LCD to stabilize after initialization
      await this.delay(100);

      this.connected = true;
      logger.info(
        { i2cBus: this.i2cBus, i2cAddress: `0x${this.i2cAddress.toString(16)}` },
        '[LCD] Display initialized'
      );

      // Show idle screen
      logger.info('[LCD] Calling showIdle...');
      await this.showIdle();
      logger.info('[LCD] showIdle completed');

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, '[LCD] Failed to initialize display (running without LCD)');
      this.connected = false;
    }
  }

  /**
   * Test I2C connection by reading from the device
   */
  private async testConnection(): Promise<void> {
    try {
      await execAsync(`i2cdetect -y ${this.i2cBus}`);
      // Check if device is present at address
      const result = await execAsync(`i2cget -y ${this.i2cBus} 0x${this.i2cAddress.toString(16)} 2>/dev/null`);
      if (!result.stdout.trim()) {
        throw new Error(`No device at address 0x${this.i2cAddress.toString(16)}`);
      }
    } catch {
      throw new Error(`I2C device not found at bus ${this.i2cBus}, address 0x${this.i2cAddress.toString(16)}`);
    }
  }

  /**
   * Initialize the LCD display
   * Standard pinout: D4-D7 on P4-P7
   */
  private async initLcd(): Promise<void> {
    // Wait for LCD to power up
    await this.delay(200);

    // Initialize in 4-bit mode - HD44780 standard sequence
    // Send 0x3 (8-bit mode) three times, then 0x2 (4-bit mode)
    // With standard pinout, nibbles go to P4-P7 (high bits)
    await this.write4bits(0x30);  // Function set 8-bit
    await this.delay(50);
    await this.write4bits(0x30);  // Function set 8-bit
    await this.delay(50);
    await this.write4bits(0x30);  // Function set 8-bit
    await this.delay(50);
    await this.write4bits(0x20);  // Function set 4-bit
    await this.delay(50);

    // Configure LCD
    await this.sendCommand(LCD_FUNCTION_SET);  // 4-bit, 2 lines, 5x8
    await this.delay(50);
    await this.sendCommand(LCD_DISPLAY_ON);    // Display on, cursor off
    await this.delay(50);
    await this.sendCommand(LCD_CLEAR);         // Clear display
    await this.delay(50);
    await this.sendCommand(LCD_ENTRY_MODE);    // Increment, no shift (left to right)
    await this.delay(50);
    await this.sendCommand(LCD_HOME);          // Cursor home
    await this.delay(50);
  }

  /**
   * Write 4 bits to LCD
   */
  private async write4bits(value: number): Promise<void> {
    const data = value | (this.backlight ? LCD_BACKLIGHT : 0);
    await this.i2cWrite(data);
    await this.pulseEnable(data);
  }

  /**
   * Pulse the enable pin
   */
  private async pulseEnable(data: number): Promise<void> {
    await this.i2cWrite(data | LCD_ENABLE);
    await this.delay(2);
    await this.i2cWrite(data & ~LCD_ENABLE);
    await this.delay(2);
  }

  /**
   * Send a command to LCD
   */
  private async sendCommand(cmd: number): Promise<void> {
    await this.sendByte(cmd, LCD_COMMAND);
  }

  /**
   * Send a character to LCD
   */
  private async sendChar(char: number): Promise<void> {
    await this.sendByte(char, LCD_DATA);
  }

  /**
   * Send a byte (as two 4-bit nibbles)
   * Standard pinout: D4-D7 on P4-P7, so nibbles go to high bits
   */
  private async sendByte(value: number, mode: number): Promise<void> {
    const high = (value & 0xF0) | mode;         // High nibble to P4-P7
    const low = ((value << 4) & 0xF0) | mode;   // Low nibble to P4-P7
    await this.write4bits(high);
    await this.write4bits(low);
  }

  /**
   * Write to I2C device
   */
  private async i2cWrite(value: number): Promise<void> {
    try {
      await execAsync(`i2cset -y ${this.i2cBus} 0x${this.i2cAddress.toString(16)} ${value}`);
    } catch (error) {
      // Silently ignore write errors to avoid log spam
    }
  }

  /**
   * Set cursor position
   */
  private async setCursor(col: number, row: number): Promise<void> {
    const rowOffset = LCD_ROW_OFFSETS[row] ?? 0;
    const addr = rowOffset + col;
    await this.sendCommand(0x80 | addr);
  }

  /**
   * Write a string at current cursor position
   */
  private async writeString(text: string): Promise<void> {
    for (const char of text) {
      await this.sendChar(char.charCodeAt(0));
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a function with exclusive access to the LCD
   * Prevents concurrent I2C operations that corrupt the display
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for any pending operation to complete
    const previousLock = this.writeLock;
    let releaseLock: () => void;

    // Create a new lock that will be released when this operation completes
    this.writeLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    try {
      await previousLock;
      return await fn();
    } finally {
      releaseLock!();
    }
  }

  /**
   * Show idle screen (no workflow active)
   */
  async showIdle(): Promise<void> {
    if (!this.connected) return;

    return this.withLock(async () => {
      this.workflowActive = false;

      // Send HOME command to reset cursor position
      await this.sendCommand(LCD_HOME);
      await this.delay(5);

      // Force full redraw by resetting cache
      this.currentLines = ['', '', '', ''];

      await this.setLines([
        this.centerText('PipeliNostr'),
        this.centerText('Waiting for you'),
        this.centerText('to be awesome'),
        ''
      ]);
    });
  }

  /**
   * Show workflow processing screen
   */
  async showProcessing(workflowName: string, triggerSource: string): Promise<void> {
    if (!this.connected) return;

    return this.withLock(async () => {
      this.workflowActive = true;

      // Cancel any pending idle timeout
      if (this.idleTimeout) {
        clearTimeout(this.idleTimeout);
        this.idleTimeout = null;
      }

      // Send HOME command to reset cursor position
      await this.sendCommand(LCD_HOME);
      await this.delay(5);

      // Force full redraw
      this.currentLines = ['', '', '', ''];
      await this.setLines([
        this.centerText('Processing...'),
        this.truncateText(workflowName, LCD_COLS),
        this.truncateText(triggerSource, LCD_COLS),
        this.centerText('Wait for it!')
      ]);
    });
  }

  /**
   * Show workflow completion
   */
  async showComplete(success: boolean): Promise<void> {
    if (!this.connected) return;

    return this.withLock(async () => {
      this.workflowActive = false;

      const statusLine = success ? 'Done!' : 'Failed!';

      // Send HOME command to reset cursor position
      await this.sendCommand(LCD_HOME);
      await this.delay(5);

      // Show status briefly
      this.currentLines = ['', '', '', ''];
      await this.setLines([
        this.centerText(statusLine),
        '',
        '',
        ''
      ]);

      // Return to idle after 2 seconds
      this.idleTimeout = setTimeout(() => {
        this.showIdle();
      }, 2000);
    });
  }

  /**
   * Set all 4 lines at once
   */
  async setLines(lines: string[]): Promise<void> {
    if (!this.connected) return;

    for (let i = 0; i < LCD_ROWS; i++) {
      await this.setLine(i, lines[i] || '');
      await this.delay(50); // Give LCD time to process
    }
  }

  /**
   * Set a single line
   */
  async setLine(row: number, text: string): Promise<void> {
    if (!this.connected || row < 0 || row >= LCD_ROWS) return;

    const paddedText = this.padText(text, LCD_COLS);

    // Only update if text changed
    if (this.currentLines[row] === paddedText) return;

    this.currentLines[row] = paddedText;

    logger.info({ row, text: paddedText.trim() }, '[LCD] Writing line');
    await this.setCursor(0, row);
    await this.delay(2); // Wait for cursor to be set
    await this.writeString(paddedText);
  }

  /**
   * Clear the display
   */
  async clear(): Promise<void> {
    if (!this.connected) return;

    await this.sendCommand(LCD_CLEAR);
    await this.delay(2);
    this.currentLines = ['', '', '', ''];
  }

  /**
   * Set relay URLs for profile fetching
   */
  setRelayUrls(urls: string[]): void {
    this.relayUrls = urls;
  }

  /**
   * Format trigger source for display
   * Converts npub to name or short format
   */
  formatTriggerSource(source: string | undefined): string {
    if (!source) return 'Manual';

    // Check if it's an npub
    if (source.startsWith('npub1')) {
      // Check cache first
      const cachedName = this.profileCache.get(source);
      if (cachedName) {
        return cachedName;
      }

      // Check for static config mapping (fallback)
      if (this.config.npub_names && this.config.npub_names[source]) {
        return this.config.npub_names[source];
      }

      // Use short format as fallback
      return `${source.slice(0, 8)}...${source.slice(-4)}`;
    }

    // HTTP trigger
    if (source === 'http' || source === 'webhook') {
      return 'HTTP';
    }

    // Hook trigger
    if (source === 'hook') {
      return 'Hook';
    }

    return source;
  }

  /**
   * Format trigger source for display (async version)
   * Tries to fetch profile name with a short timeout before falling back
   */
  async formatTriggerSourceAsync(source: string | undefined, timeoutMs: number = 500): Promise<string> {
    if (!source) return 'Manual';

    // Check if it's an npub
    if (source.startsWith('npub1')) {
      // Check cache first
      const cachedName = this.profileCache.get(source);
      if (cachedName) {
        return cachedName;
      }

      // Check for static config mapping
      if (this.config.npub_names && this.config.npub_names[source]) {
        return this.config.npub_names[source];
      }

      // Try to fetch with timeout
      try {
        const name = await Promise.race([
          this.fetchProfileName(source),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
        ]);
        if (name) {
          return name;
        }
      } catch {
        // Ignore fetch errors
      }

      // Use short format as fallback
      return `${source.slice(0, 8)}...${source.slice(-4)}`;
    }

    // HTTP trigger
    if (source === 'http' || source === 'webhook') {
      return 'HTTP';
    }

    // Hook trigger
    if (source === 'hook') {
      return 'Hook';
    }

    return source;
  }

  /**
   * Fetch and cache profile name for an npub
   * Returns the display name or null if not found
   */
  async fetchProfileName(npub: string): Promise<string | null> {
    // Check cache first
    if (this.profileCache.has(npub)) {
      return this.profileCache.get(npub) || null;
    }

    // Check if already fetching
    if (this.profileFetchPromises.has(npub)) {
      return this.profileFetchPromises.get(npub) || null;
    }

    // No relays configured
    if (this.relayUrls.length === 0) {
      return null;
    }

    // Start fetch
    const fetchPromise = this.doFetchProfile(npub);
    this.profileFetchPromises.set(npub, fetchPromise);

    try {
      const name = await fetchPromise;
      if (name) {
        this.profileCache.set(npub, name);
        logger.debug({ npub: npub.slice(0, 12), name }, '[LCD] Profile name cached');
      }
      return name;
    } finally {
      this.profileFetchPromises.delete(npub);
    }
  }

  /**
   * Actually fetch profile from relays
   */
  private async doFetchProfile(npub: string): Promise<string | null> {
    try {
      // Decode npub to hex pubkey
      const decoded = nip19.decode(npub);
      if (decoded.type !== 'npub') {
        return null;
      }
      const pubkey = decoded.data as string;

      // Use SimplePool from nostr-tools
      const { SimplePool } = await import('nostr-tools');
      const pool = new SimplePool();

      try {
        // Fetch kind 0 (metadata) event with timeout
        const event = await Promise.race([
          pool.get(this.relayUrls, { kinds: [0], authors: [pubkey] }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
        ]);

        if (event?.content) {
          const profile = JSON.parse(event.content) as NostrProfile;
          // Prefer display_name, then name
          const displayName = profile.display_name || profile.name;
          if (displayName) {
            // Truncate to fit LCD (max 20 chars)
            return displayName.length > 20 ? displayName.slice(0, 17) + '...' : displayName;
          }
        }
      } finally {
        pool.close(this.relayUrls);
      }
    } catch (error) {
      logger.debug({ npub: npub.slice(0, 12), error }, '[LCD] Failed to fetch profile');
    }

    return null;
  }

  /**
   * Pre-fetch profile name and update display if needed
   */
  async prefetchProfile(npub: string): Promise<void> {
    if (!npub.startsWith('npub1')) return;
    if (this.profileCache.has(npub)) return;

    const name = await this.fetchProfileName(npub);

    // If we got a name and workflow is still showing this trigger, update display
    if (name && this.workflowActive && this.currentLines[2]?.includes('...')) {
      await this.setLine(2, this.truncateText(name, LCD_COLS));
    }
  }

  /**
   * Center text within LCD width
   */
  private centerText(text: string): string {
    if (text.length >= LCD_COLS) {
      return text.substring(0, LCD_COLS);
    }
    const padding = Math.floor((LCD_COLS - text.length) / 2);
    return ' '.repeat(padding) + text;
  }

  /**
   * Truncate text to fit LCD width
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Pad text to exact width (fill with spaces)
   */
  private padText(text: string, width: number): string {
    if (text.length >= width) {
      return text.substring(0, width);
    }
    return text + ' '.repeat(width - text.length);
  }

  /**
   * Check if LCD is connected and working
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Set backlight on/off
   */
  async setBacklight(on: boolean): Promise<void> {
    this.backlight = on;
    if (this.connected) {
      await this.i2cWrite(on ? LCD_BACKLIGHT : 0);
    }
  }

  /**
   * Shutdown the LCD display
   */
  async shutdown(): Promise<void> {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    if (this.connected) {
      // Show shutdown message
      await this.clear();
      await this.setLine(1, this.centerText('PipeliNostr'));
      await this.setLine(2, this.centerText('Shutting down...'));

      // Wait a bit for message to display
      await this.delay(500);

      this.connected = false;
      logger.info('[LCD] Display shutdown');
    }
  }
}

// Singleton instance
export const lcdDisplay = new LcdDisplayManager();
