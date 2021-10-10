export class CustomError extends Error {
  code: number;
  constructor(message = 'Error occured', code = 400) {
    super(message);
    this.code = code;
  }
}
