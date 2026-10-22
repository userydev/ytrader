"""Pure, explicit-input algorithms. No storage, network, configuration reads or clocks."""
from .registry import algorithm_versions, registry

__all__ = ['algorithm_versions', 'registry']
