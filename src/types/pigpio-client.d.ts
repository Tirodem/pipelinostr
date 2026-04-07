declare module 'pigpio-client' {
  export function pigpio(options?: { host?: string; port?: number }): PigpioClient;

  interface PigpioClient {
    gpio(pin: number): GpioPin;
    once(event: 'connected' | 'error', callback: (...args: unknown[]) => void): void;
    end(): void;
  }

  interface GpioPin {
    modeSet(mode: 'input' | 'output'): void;
    write(value: number): void;
    read(): number;
    analogWrite(value: number): void;
    servoWrite(pulseWidth: number): void;
  }
}
