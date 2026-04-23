import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ERROR_CODES } from './error-handler';

interface ValidateOptions {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(schemas: ValidateOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: { location: string; issues: any[] }[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        errors.push({ location: 'body', issues: result.error.issues });
      } else {
        req.body = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        errors.push({ location: 'query', issues: result.error.issues });
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        errors.push({ location: 'params', issues: result.error.issues });
      }
    }

    if (errors.length > 0) {
      const details = errors.flatMap(e =>
        e.issues.map((i: any) => ({
          location: e.location,
          path: i.path.join('.'),
          message: i.message,
        }))
      );
      res.status(400).json({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Request validation failed',
          details: { issues: details },
          request_id: (req as any).requestId || '',
        },
      });
      return;
    }

    next();
  };
}
