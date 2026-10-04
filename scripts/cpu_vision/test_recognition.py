import unittest
import numpy as np
import torch
from PIL import Image
from common import text_matches, decide, Recognizer


class RecognitionTests(unittest.TestCase):
    def guided_recognizer(self, second_text):
        recognizer = Recognizer.__new__(Recognizer)
        recognizer.metadata = {'labels': ['i5-12400', 'i5-12400F'],
            'families': ['i5'], 'brands': ['Intel'], 'temperature': 1,
            'familyTemperature': 1, 'brandTemperature': 1,
            'policy': {'topK': 1, 'ocrMinConfidence': 0.6, 'enabled': True},
            'version': 'test', 'evaluation': {'test': {'fusion': {}}}}
        recognizer.net = lambda image: torch.zeros((1, 960))
        recognizer.head = lambda feature: torch.tensor([[0., 9.]])
        recognizer.family_head = recognizer.brand_head = lambda feature: torch.zeros((1, 1))
        class Reader:
            calls = 0
            def readtext(self, image, **kwargs):
                self.calls += 1
                return [([[20, 20], [100, 20], [100, 40], [20, 40]],
                         'Intel Core' if self.calls == 1 else second_text, 0.99)]
        recognizer.reader = Reader()
        return recognizer

    def test_gemma_hypothesis_triggers_pixel_based_recheck_not_a_forced_label(self):
        recognizer = self.guided_recognizer('Intel Core i5-12400F')
        result = recognizer.recognize(Image.new('RGB', (200, 100)), 'Category: CPU\nModel: i5-12400')
        self.assertEqual(recognizer.reader.calls, 2)
        self.assertTrue(result['guided']['focusedOcr'])
        self.assertEqual(result['guided']['hypothesis'], 'i5-12400')
        self.assertTrue(result['accepted'])
        self.assertEqual(result['model'], 'i5-12400F')

    def test_gemma_without_legible_pixels_cannot_make_cpu_accept(self):
        recognizer = self.guided_recognizer('unreadable')
        result = recognizer.recognize(Image.new('RGB', (200, 100)), 'Model: i5-12400F')
        self.assertFalse(result['accepted'])
        self.assertTrue(result['questions'])
        recognizer = self.guided_recognizer('Intel Core i5-12400F')
        result = recognizer.recognize(Image.new('RGB', (200, 100)))
        self.assertEqual(recognizer.reader.calls, 1)
        self.assertFalse(result['guided']['receivedGemma'])

    def test_intel_suffix_is_not_lost(self):
        labels = ['i5-12400', 'i5-12400F', 'i5-12600K', 'i5-12600KF']
        self.assertEqual(text_matches([('Intel Core i5-12400F', 0.99)], labels)[0], ['i5-12400F'])
        self.assertEqual(text_matches([('i5 12600 K F', 0.99)], labels)[0], ['i5-12600KF'])
        self.assertEqual(text_matches([('i5-12400F', 0.3)], labels)[0], [])
        self.assertEqual(text_matches([('i5-12400', 0.99), ('F', 0.3)], labels)[0], [])
        self.assertEqual(text_matches([('Intel Core 15-12400F', 0.99)], labels)[0], ['i5-12400F'])
        self.assertEqual(text_matches([('Intel Core i5-124OOF', 0.99)], labels)[0], [])

    def test_amd_variants_need_vendor_and_complete_text(self):
        labels = ['R5-5600', 'R5-5600X', 'R5-5600XT', 'R7-5800X3D']
        self.assertEqual(text_matches([('AMD Ryzen 5 5600XT', 0.99)], labels)[0], ['R5-5600XT'])
        self.assertEqual(text_matches([('AMD Ryzen 7 5800X3D', 0.99)], labels)[0], ['R7-5800X3D'])
        self.assertEqual(text_matches([('price 5600', 0.99)], labels)[0], [])
        self.assertEqual(text_matches([('AMD Radeon RX 5600XT', 0.99)], labels)[0], [])

    def test_ultra_plus_and_conflicts(self):
        labels = ['Ultra 5 245K', 'Ultra 5 245KF', 'Ultra 5 250K Plus']
        self.assertEqual(text_matches([('Core Ultra 5 245KF', 0.99)], labels)[0], ['Ultra 5 245KF'])
        self.assertEqual(text_matches([('Ultra 5 250K', 0.99)], labels)[0], [])

    def test_visual_score_alone_cannot_confirm_identity(self):
        policy = {'topK': 1, 'ocrMinConfidence': 0.6, 'enabled': True}
        labels = ['i5-12400', 'i5-12400F']
        self.assertFalse(decide(np.array([0.999, 0.001]), labels, [], policy)['accepted'])
        self.assertFalse(decide(np.array([0.999, 0.001]), labels, [('i5-12400F', 0.99)], policy)['accepted'])
        self.assertTrue(decide(np.array([0.001, 0.999]), labels, [('i5-12400F', 0.99)], policy)['accepted'])
        policy['enabled'] = False
        self.assertFalse(decide(np.array([0.001, 0.999]), labels, [('i5-12400F', 0.99)], policy)['accepted'])

    def test_trained_family_can_corroborate_complete_text(self):
        policy = {'topK': 1, 'ocrMinConfidence': 0.75, 'enabled': True,
                  'allowFamily': True, 'familyMinProbability': 0.5}
        labels = ['i3-12100', 'i5-12400F']
        result = decide(np.array([0.7, 0.3]), labels, [('i5-12400F', 0.95)], policy, {'i3': 0.1, 'i5': 0.9})
        self.assertTrue(result['accepted'])
        self.assertFalse(decide(np.array([0.7, 0.3]), labels, [('i5-12400F', 0.95)], policy, {'i3': 0.9, 'i5': 0.1})['accepted'])

    def test_brand_guard_still_requires_an_exact_readable_sku(self):
        policy = {'topK': 1, 'ocrMinConfidence': 0.6, 'enabled': True,
                  'allowBrand': True, 'brandMinProbability': 0.7}
        labels = ['i5-12400F', 'R5-5600X']
        scores = np.array([0.1, 0.9])
        self.assertTrue(decide(scores, labels, [('Intel Core i5-12400F', 0.99)], policy,
                               brand_probabilities={'Intel': 0.95, 'AMD': 0.05})['accepted'])
        self.assertFalse(decide(scores, labels, [('Intel Core i5-12400F', 0.99)], policy,
                                brand_probabilities={'Intel': 0.05, 'AMD': 0.95})['accepted'])
        self.assertFalse(decide(scores, labels, [('Intel Core i5-12400', 0.99)], policy,
                                brand_probabilities={'Intel': 0.95, 'AMD': 0.05})['accepted'])


if __name__ == '__main__':
    unittest.main()
